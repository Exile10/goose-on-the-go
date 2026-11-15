/**
 * Voice mode: talk, and Goose answers out loud.
 *
 * pond-desktop's browser pipeline (`useVoicePipeline.ts`), on a phone:
 *
 *   listen    PCM from the microphone, measured as it arrives. Speech has
 *             begun once it is loud for 60ms and has ended after a pause.
 *   hear      the samples as a 16 kHz WAV, to `/transcribe`.
 *   answer    the words as an ordinary turn with `voice_mode`, so it lands in
 *             the conversation like anything typed — and is shorter. Where the
 *             Pond takes recordings, the clip goes too, the words beside it:
 *             its model hears the clip, or the words stand in.
 *   speak     each clause of the reply to `/tts` as soon as it is whole,
 *             played in order, the next one fetched while this one plays.
 *
 * Then it listens again, as a conversation would, until eight seconds pass
 * with nothing said. The orb is tapped to begin, to finish speaking early, to
 * stop Goose talking, or to call off a turn.
 *
 * Everything the pipeline decides is held in refs and read by the callbacks
 * that the microphone and the player call back into; state is only what the
 * screen draws. A stage that set state and read it back on the next render
 * would be a frame behind the audio it is reacting to.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { VoiceState } from '@/models/voice';
import { useOptionalServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import { bytesToBase64, type Attachment } from '@/services/media';
import {
  MAX_SPEECH_MS,
  SILENCE_MS,
  SPEECH_END,
  SPEECH_HOLD_MS,
  SPEECH_RATE,
  SPEECH_START,
  concatSamples,
  downsample,
  encodeWav,
  envelope,
  orbLevel,
  rms,
  takeSpeechUnits,
  wavSeconds,
  type SpeechUnit,
} from '@/services/speech';
import { TTS_LIMITS, createSpeechLine } from '@/services/speech-line';
import {
  beginVoiceSession,
  cacheFile,
  discardFile,
  endVoiceSession,
  playFile,
  requestMicrophone,
  useMicStream,
  voiceSupported,
  type MicBuffer,
} from '@/services/voice-io';
import type { UseChat } from '@/view-models/use-chat';
import { failureKind } from '@/view-models/describe-error';

/** Listening this long with nothing said puts the microphone away. */
const NO_SPEECH_MS = 8_000;
/** Kept from before speech is detected, so its first syllable is not clipped. */
const PREROLL_MS = 300;
/** How often the orb hears about the level. The eye cannot use more. */
const LEVEL_EVERY_MS = 60;

/**
 * What Whisper is known to hear in silence. A clip that transcribes to one of
 * these said nothing, and sending it would have Goose answer the room.
 */
export function isPhantom(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (!t) return true;
  if (/^[[(].*[\])]$/.test(t)) return true; // [BLANK_AUDIO], (music), [inaudible]
  // 'bye' is excluded here: checkDismissal below gives it a proper spoken farewell
  // instead of silently discarding it as noise.
  return ['you', 'thank you', 'thanks', 'thanks for watching'].includes(t);
}

const EXIT_PHRASES = ['exit', 'quit'];
const DISMISSAL_PHRASES = [
  'bye',
  'goodbye',
  'good bye',
  'see you',
  'see ya',
  'dismissed',
  'stop',
  'stop listening',
  'shut up',
  "that's all",
  'that is all',
  'go to sleep',
  'never mind',
  'nevermind',
];

/**
 * Whole-utterance match (never a substring — "stop the kitchen timer" is not a
 * dismissal) against a goodbye/stop phrase, so the auto-listen loop can end a
 * conversation with a spoken farewell instead of asking the LLM.
 */
export function checkDismissal(text: string): { dismissed: boolean; isExit: boolean } {
  const lower = text.trim().toLowerCase().replace(/[.!]+$/, '');
  if (EXIT_PHRASES.some((p) => lower === p)) return { dismissed: true, isExit: true };
  if (DISMISSAL_PHRASES.some((p) => lower === p)) return { dismissed: true, isExit: false };
  return { dismissed: false, isExit: false };
}

export interface UseVoice {
  data: {
    state: VoiceState;
    /** 0..1, the microphone while listening and the reply while speaking. */
    level: number;
    /** Whether replies are spoken. Off, voice mode still hears; Goose answers in text. */
    speaker: boolean;
    error: string | null;
    /**
     * The microphone is refused and the OS will not ask again, so the only
     * way back is the Settings app. Distinct from a plain refusal, which a
     * further tap can still resolve.
     */
    micBlocked: boolean;
    /** False on a build that predates the audio module. */
    supported: boolean;
  };
  actions: {
    /** The orb: begin, finish, interrupt or call off, depending on the moment. */
    tap: () => void;
    toggleSpeaker: () => void;
    /** Leave voice mode: everything stops and the audio session is handed back. */
    end: () => void;
  };
}

export function useVoice(chat: {
  send: UseChat['actions']['send'];
  stop: UseChat['actions']['stop'];
  /** Send each turn's recording with its words, for a Pond whose model hears it. */
  sendsRecordings?: boolean;
}): UseVoice {
  const { t } = useTranslation();
  const [state, setStateRaw] = useState<VoiceState>('idle');
  const [level, setLevel] = useState(0);
  const [speaker, setSpeaker] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [micBlocked, setMicBlocked] = useState(false);

  const stateRef = useRef<VoiceState>('idle');
  const setState = useCallback((next: VoiceState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  const speakerRef = useRef(true);
  const alive = useRef(true);
  const sendRef = useRef(chat.send);
  const recordingsRef = useRef(Boolean(chat.sendsRecordings));
  recordingsRef.current = Boolean(chat.sendsRecordings);
  const stopRef = useRef(chat.stop);
  useEffect(() => {
    sendRef.current = chat.send;
    stopRef.current = chat.stop;
  }, [chat.send, chat.stop]);

  // A recording the Pond never received because nothing answered: Try again sends it once a
  // route answers, rather than asking the person to say it again. The assistant overlay has no
  // connection manager; there Try again sends it straight away.
  const retryNow = useOptionalServer()?.retryNow;
  const retryRef = useRef(retryNow);
  useEffect(() => {
    retryRef.current = retryNow;
  }, [retryNow]);
  const unsent = useRef<{ wav: Uint8Array; count: number; rate: number } | null>(null);

  // What the microphone has heard this turn, and what it has decided.
  const take = useRef({
    chunks: [] as Int16Array[],
    rate: SPEECH_RATE,
    started: false,
    loudSince: 0,
    quietSince: 0,
    listenedAt: 0,
    speechAt: 0,
    levelAt: 0,
  });

  // The reply being spoken: units waiting, and the one playing.
  const voice = useRef({
    line: createSpeechLine(
      (unit, signal) => api.speak(unit.text, signal, unit.last),
      TTS_LIMITS,
      (audio) => wavSeconds(new Uint8Array(audio)),
    ),
    pumping: false,
    stopPlaying: null as null | (() => void),
    turnDone: false,
    generation: 0,
  });

  // How the microphone callback reaches `finish`, which is defined after it.
  const finishRef = useRef<(heard: boolean) => void>(() => {});

  const reportLevel = useCallback((value: number) => {
    const now = Date.now();
    if (now - take.current.levelAt < LEVEL_EVERY_MS) return;
    take.current.levelAt = now;
    setLevel(value);
  }, []);

  const onBuffer = useCallback((buffer: MicBuffer) => {
    const s = stateRef.current;
    if (s !== 'wait' && s !== 'recording') return;
    const tk = take.current;
    const now = Date.now();
    const loud = rms(buffer.samples);
    tk.rate = buffer.sampleRate;
    tk.chunks.push(buffer.samples);
    reportLevel(orbLevel(loud));

    if (!tk.started) {
      // Before speech: keep only the pre-roll, and give up after a while.
      let kept = tk.chunks.reduce((n, c) => n + c.length, 0);
      const keep = (buffer.sampleRate * PREROLL_MS) / 1000;
      while (tk.chunks.length > 1 && kept - tk.chunks[0].length >= keep) {
        kept -= tk.chunks[0].length;
        tk.chunks.shift();
      }
      if (loud >= SPEECH_START) {
        if (!tk.loudSince) tk.loudSince = now;
        if (now - tk.loudSince >= SPEECH_HOLD_MS) {
          tk.started = true;
          tk.speechAt = now;
          setState('recording');
        }
      } else {
        tk.loudSince = 0;
        if (now - tk.listenedAt > NO_SPEECH_MS) finishRef.current(false);
      }
      return;
    }

    if (loud < SPEECH_END) {
      if (!tk.quietSince) tk.quietSince = now;
      if (now - tk.quietSince >= SILENCE_MS) finishRef.current(true);
    } else {
      tk.quietSince = 0;
    }
    if (now - tk.speechAt > MAX_SPEECH_MS) finishRef.current(true);
  }, [reportLevel, setState]);

  const mic = useMicStream(onBuffer);
  const micRef = useRef(mic);
  useEffect(() => {
    micRef.current = mic;
  }, [mic]);

  const stopSpeaking = useCallback(() => {
    const v = voice.current;
    v.generation += 1;
    // Cancels what is still rendering, so the Pond stops on what nobody will hear.
    v.line.clear();
    v.stopPlaying?.();
    v.stopPlaying = null;
  }, []);

  const listen = useCallback(async () => {
    // Asked first, and awaited, even where the answer is already known: every
    // state change here then happens after the effect that opened voice mode.
    const mic = await requestMicrophone();
    if (!alive.current) return;
    if (!mic.granted) {
      // A refusal the OS will still reconsider asks again on the next tap; one
      // it will not needs the user sent to Settings, and says so.
      const blocked = voiceSupported() && !mic.canAskAgain;
      setMicBlocked(blocked);
      setError(
        t(
          !voiceSupported()
            ? 'chat.voice.needsUpdate'
            : blocked
              ? 'chat.voice.micBlocked'
              : 'chat.voice.micDenied',
        ),
      );
      setState('error');
      return;
    }
    setMicBlocked(false);
    await beginVoiceSession();
    if (!alive.current) return;
    take.current = {
      chunks: [],
      rate: SPEECH_RATE,
      started: false,
      loudSince: 0,
      quietSince: 0,
      listenedAt: Date.now(),
      speechAt: 0,
      levelAt: 0,
    };
    setError(null);
    setState('wait');
    try {
      await micRef.current.start();
    } catch {
      setError(t('chat.voice.micFailed'));
      setState('error');
    }
  }, [setState, t]);

  /**
   * Speak whatever is queued, in order. While one unit plays the next ones are
   * already being synthesised, because `/tts` renders a whole request before it
   * sends a byte. A Pond slower than its own speech still cannot keep up, so
   * sound that starts from silence is held until the rest can follow it.
   */
  const pump = useCallback(async () => {
    const v = voice.current;
    if (v.pumping) return;
    v.pumping = true;
    const generation = v.generation;
    let afterSilence = true;
    try {
      while (generation === v.generation) {
        const audio = v.line.next();
        if (!audio) break;
        const bytes = await audio;
        if (generation !== v.generation) break;
        const wav = new Uint8Array(bytes);
        const hold = v.line.hold(wavSeconds(wav), afterSilence);
        afterSilence = false;
        if (hold > 0.05) {
          await new Promise((resolve) => setTimeout(resolve, hold * 1000));
          if (generation !== v.generation) break;
        }
        const env = envelope(wav);
        const uri = cacheFile('reply', wav);
        setState('speaking');
        const playing = playFile(uri, (seconds) => {
          const at = Math.floor((seconds * 1000) / env.stepMs);
          reportLevel(env.levels.length ? orbLevel(env.levels[at] ?? 0) : 0.4);
        });
        v.stopPlaying = playing.stop;
        await playing.done;
        v.stopPlaying = null;
        discardFile(uri);
      }
    } catch {
      if (generation === v.generation) {
        setError(t('chat.voice.speakFailed'));
        v.line.clear();
      }
    } finally {
      v.pumping = false;
      setLevel(0);
      // The reply is fully spoken: the conversation's turn passes back.
      if (generation === v.generation && v.turnDone && v.line.pending === 0 && alive.current) {
        void listen();
      }
    }
  }, [listen, reportLevel, setState, t]);

  /** A fixed spoken line (farewell/exit) — no LLM turn, then voice mode goes idle. */
  const speakFarewell = useCallback(
    async (line: string) => {
      if (!speakerRef.current) {
        setState('idle');
        return;
      }
      setState('speaking');
      try {
        const bytes = await api.speak(line);
        if (!alive.current) return;
        const wav = new Uint8Array(bytes);
        const env = envelope(wav);
        const uri = cacheFile('reply', wav);
        const playing = playFile(uri, (seconds) => {
          const at = Math.floor((seconds * 1000) / env.stepMs);
          reportLevel(env.levels.length ? orbLevel(env.levels[at] ?? 0) : 0.4);
        });
        await playing.done;
        discardFile(uri);
      } catch {
        // A farewell that fails to play still ends the turn quietly.
      } finally {
        setLevel(0);
        if (alive.current) setState('idle');
      }
    },
    [reportLevel, setState],
  );

  const converse = useCallback(
    async (text: string, clip?: Attachment) => {
      const v = voice.current;
      v.turnDone = false;
      v.line.clear();
      let cursor = 0;
      setState('thinking');
      const enqueue = (units: SpeechUnit[]) => {
        if (!speakerRef.current || units.length === 0) return;
        v.line.push(units);
        void pump();
      };
      const reply = await sendRef.current(text, clip ? [clip] : [], {
        voice: true,
        onText: (full) => {
          // Working notes set aside shorten the reply; what is left of it was already said.
          const { units, next } = takeSpeechUnits(full, Math.min(cursor, full.length));
          cursor = next;
          enqueue(units);
        },
      });
      if (!alive.current) return;
      v.turnDone = true;
      if (reply) enqueue(takeSpeechUnits(reply, cursor, true).units);
      // Nothing to say aloud, or the speaker is off: listen again now.
      if (!v.pumping && v.line.pending === 0) {
        setLevel(0);
        void listen();
      }
    },
    [listen, pump, setState],
  );

  /** Sends a recording to be transcribed, then on to the conversation. */
  const hear = useCallback(
    async (wav: Uint8Array, count: number, rate: number) => {
      setState('thinking');
      const uri = cacheFile('speech', wav);
      let text = '';
      try {
        text = await api.transcribe(uri);
      } catch (e) {
        console.warn('[voice] transcribe failed:', e);
        if (!alive.current) return;
        // Nothing answered is not the Pond mishearing: say so, and keep the words for Try again.
        const lost = failureKind(e) === 'network';
        unsent.current = lost ? { wav, count, rate } : null;
        setError(t(lost ? 'chat.voice.lostConnection' : 'chat.voice.hearFailed'));
        setState('error');
        return;
      } finally {
        discardFile(uri);
      }
      unsent.current = null;
      if (!alive.current) return;
      if (isPhantom(text)) {
        void listen();
        return;
      }
      const dismissal = checkDismissal(text);
      if (dismissal.dismissed) {
        void speakFarewell(t(dismissal.isExit ? 'chat.voice.farewellExit' : 'chat.voice.farewellPause'));
        return;
      }
      void converse(
        text,
        recordingsRef.current ? spokenClip(text, wav, Math.round((count / rate) * 1000)) : undefined,
      );
    },
    [converse, listen, setState, speakFarewell, t],
  );

  const finish = useCallback(
    async (heard: boolean) => {
      const tk = take.current;
      micRef.current.stop();
      setLevel(0);
      if (!heard || !tk.started) {
        setState('idle');
        return;
      }
      setState('thinking');
      const samples = downsample(concatSamples(tk.chunks), tk.rate);
      tk.chunks = [];
      const rate = tk.rate >= SPEECH_RATE ? SPEECH_RATE : tk.rate;
      await hear(encodeWav(samples, rate), samples.length, rate);
    },
    [hear, setState],
  );

  /** Try again after a lost connection: find a route that answers, then send what was said. */
  const resend = useCallback(async () => {
    const pending = unsent.current;
    if (!pending) return;
    setError(null);
    setState('thinking');
    const route = retryRef.current ? await retryRef.current() : 'unchecked';
    if (!alive.current) return;
    if (!route) {
      setError(t('chat.voice.stillUnreachable'));
      setState('error');
      return;
    }
    await hear(pending.wav, pending.count, pending.rate);
  }, [hear, setState, t]);

  // The microphone callback is created before `finish` exists, and must always
  // reach the current one.
  useEffect(() => {
    finishRef.current = (heard) => void finish(heard);
  }, [finish]);

  const tap = useCallback(() => {
    const s = stateRef.current;
    if (s === 'error' && unsent.current) {
      void resend();
    } else if (s === 'idle' || s === 'error') {
      void listen();
    } else if (s === 'wait') {
      finishRef.current(false);
    } else if (s === 'recording') {
      finishRef.current(true);
    } else if (s === 'speaking') {
      voice.current.turnDone = false;
      stopSpeaking();
      void listen();
    } else if (s === 'thinking') {
      stopSpeaking();
      stopRef.current();
      setState('idle');
    }
  }, [listen, resend, setState, stopSpeaking]);

  const toggleSpeaker = useCallback(() => {
    const next = !speakerRef.current;
    speakerRef.current = next;
    setSpeaker(next);
    if (!next) {
      // Muting mid-sentence stops the voice now, not at the end of the sentence.
      stopSpeaking();
      if (voice.current.turnDone) void listen();
    }
  }, [listen, stopSpeaking]);

  const end = useCallback(() => {
    micRef.current.stop();
    stopSpeaking();
    void endVoiceSession();
    setLevel(0);
    setState('idle');
  }, [setState, stopSpeaking]);

  // Opening voice mode means listening; closing it means everything stops.
  // The first listen waits a tick, so it begins after the orb it listens with
  // has drawn rather than inside the effect that mounted it.
  useEffect(() => {
    alive.current = true;
    const start = setTimeout(() => void listen(), 0);
    const mic = micRef.current;
    return () => {
      clearTimeout(start);
      alive.current = false;
      mic.stop();
      stopSpeaking();
      void endVoiceSession();
    };
  }, [listen, stopSpeaking]);

  return {
    data: { state, level, speaker, error, micBlocked, supported: voiceSupported() },
    actions: { tap, toggleSpeaker, end },
  };
}

/** A spoken turn's recording with the words Whisper heard in it: the Pond's model hears the clip
 *  where it can, and the words stand in where it cannot. */
export function spokenClip(words: string, wav: Uint8Array, durationMs: number): Attachment {
  return {
    id: `speech-${Date.now().toString(36)}`,
    kind: 'audio',
    uri: '',
    name: 'speech.wav',
    mimeType: 'audio/wav',
    base64: bytesToBase64(wav),
    durationMs,
    heardAs: words,
  };
}
