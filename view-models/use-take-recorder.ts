/**
 * Recording short spoken takes on the phone, one after another, for the Pond to learn from: teaching
 * Goose a voice reads its sentences to this. A take starts when speech does,
 * ends after a short silence, and is handed over as a 16 kHz mono WAV; what is done with it, and
 * whether another take follows, is the caller's.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { confirm, reject } from '@/services/haptics';
import i18n from '@/services/i18n';
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
  orbLevel,
  rms,
} from '@/services/speech';
import {
  beginVoiceSession,
  cacheFile,
  discardFile,
  endVoiceSession,
  requestMicrophone,
  useMicStream,
  voiceSupported,
  type MicBuffer,
} from '@/services/voice-io';

/** A take is one short sentence; past this nobody is still saying it. */
const TAKE_MS = 8_000;
/** Kept from before speech is detected, so the first syllable is not clipped. */
const PREROLL_MS = 300;
const LEVEL_EVERY_MS = 60;

export type TakeState = 'idle' | 'listening' | 'recording' | 'sending' | 'done' | 'error';

/** What the caller does with a take: `again` records the next one, `done` ends the run. */
export type TakeOutcome = 'again' | 'done';

export interface TakeRecorder {
  state: TakeState;
  level: number;
  error: string | null;
  supported: boolean;
  /** Asks for the microphone, runs `prepare` (an old run cleared, say), then listens for the first take. */
  start: (prepare?: () => Promise<void>) => Promise<void>;
  stop: () => void;
}

export interface TakeHandlers {
  /** The take as a WAV file, deleted once this settles. Throws to end the run with `describe`'s sentence. */
  take: (uri: string) => Promise<TakeOutcome>;
  describe: (e: unknown) => string;
  /** The file name the take is cached under. */
  name: string;
  /** What to say when the phone heard no speech at all. */
  silence: string;
}

export function useTakeRecorder(handlers: TakeHandlers): TakeRecorder {
  const [state, setStateRaw] = useState<TakeState>('idle');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<TakeState>('idle');
  const alive = useRef(true);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  const take = useRef({ chunks: [] as Int16Array[], rate: SPEECH_RATE, started: false, loudSince: 0, quietSince: 0, since: 0, levelAt: 0 });
  const finishRef = useRef<(heardSpeech: boolean) => void>(() => {});

  const setState = useCallback((next: TakeState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  const onBuffer = useCallback(
    (buffer: MicBuffer) => {
      const s = stateRef.current;
      if (s !== 'listening' && s !== 'recording') return;
      const tk = take.current;
      const now = Date.now();
      const loud = rms(buffer.samples);
      tk.rate = buffer.sampleRate;
      tk.chunks.push(buffer.samples);
      if (now - tk.levelAt >= LEVEL_EVERY_MS) {
        tk.levelAt = now;
        setLevel(orbLevel(loud));
      }
      if (!tk.started) {
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
            setState('recording');
          }
        } else {
          tk.loudSince = 0;
        }
        if (now - tk.since > TAKE_MS) finishRef.current(false);
        return;
      }
      if (loud < SPEECH_END) {
        if (!tk.quietSince) tk.quietSince = now;
        if (now - tk.quietSince >= SILENCE_MS) finishRef.current(true);
      } else {
        tk.quietSince = 0;
      }
      if (now - tk.since > Math.min(TAKE_MS, MAX_SPEECH_MS)) finishRef.current(true);
    },
    [setState],
  );

  const mic = useMicStream(onBuffer);
  const micRef = useRef(mic);
  useEffect(() => {
    micRef.current = mic;
  }, [mic]);

  const listen = useCallback(async () => {
    take.current = { chunks: [], rate: SPEECH_RATE, started: false, loudSince: 0, quietSince: 0, since: Date.now(), levelAt: 0 };
    setState('listening');
    try {
      await micRef.current.start();
    } catch {
      setError(i18n.t('chat.voice.micFailed'));
      setState('error');
    }
  }, [setState]);

  const end = useCallback(
    (next: TakeState) => {
      micRef.current.stop();
      setLevel(0);
      setState(next);
      void endVoiceSession().catch(() => undefined);
    },
    [setState],
  );

  const finish = useCallback(
    (heardSpeech: boolean) => {
      if (stateRef.current !== 'listening' && stateRef.current !== 'recording') return;
      const tk = take.current;
      micRef.current.stop();
      setLevel(0);
      if (!heardSpeech || !tk.started) {
        setError(handlersRef.current.silence);
        end('error');
        return;
      }
      setState('sending');
      const samples = downsample(concatSamples(tk.chunks), tk.rate);
      tk.chunks = [];
      const uri = cacheFile(handlersRef.current.name, encodeWav(samples, tk.rate >= SPEECH_RATE ? SPEECH_RATE : tk.rate));
      void handlersRef.current
        .take(uri)
        .then(async (outcome) => {
          if (!alive.current) return;
          if (outcome === 'done') {
            void confirm();
            end('done');
            return;
          }
          setError(null);
          await listen();
        })
        .catch((e) => {
          if (!alive.current) return;
          void reject();
          setError(handlersRef.current.describe(e));
          end('error');
        })
        .finally(() => discardFile(uri));
    },
    [end, listen, setState],
  );
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  const start = useCallback(
    async (prepare?: () => Promise<void>) => {
      setError(null);
      const permission = await requestMicrophone();
      if (!alive.current) return;
      if (!permission.granted) {
        setError(
          i18n.t(!voiceSupported() ? 'chat.voice.needsUpdate' : permission.canAskAgain ? 'chat.voice.micDenied' : 'chat.voice.micBlocked'),
        );
        setState('error');
        return;
      }
      try {
        await prepare?.();
        await beginVoiceSession();
      } catch (e) {
        setError(handlersRef.current.describe(e));
        setState('error');
        return;
      }
      if (alive.current) await listen();
    },
    [listen, setState],
  );

  const stop = useCallback(() => end('idle'), [end]);

  useEffect(
    () => () => {
      alive.current = false;
      micRef.current.stop();
      void endVoiceSession().catch(() => undefined);
    },
    [],
  );

  return { state, level, error, supported: voiceSupported(), start, stop };
}
