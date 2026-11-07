/**
 * A voice note: recorded while the microphone is held, handed over when it is let go, dropped when
 * the finger slides away. It comes out as a 16 kHz mono WAV, the one format both the Pond's
 * transcriber and an audio-capable model take.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { confirm, reject, tap } from '@/services/haptics';
import i18n from '@/services/i18n';
import { SPEECH_RATE, concatSamples, downsample, encodeWav, orbLevel, rms } from '@/services/speech';
import {
  beginVoiceSession,
  endVoiceSession,
  requestMicrophone,
  useMicStream,
  voiceSupported,
  type MicBuffer,
} from '@/services/voice-io';

/** A minute: under the transcriber's 2 MiB ceiling at 16 kHz, and long enough for a thought. */
export const VOICE_NOTE_MAX_MS = 60_000;
/** Shorter than this was a tap that lingered, not something said. */
export const VOICE_NOTE_MIN_MS = 600;
const LEVEL_EVERY_MS = 60;

export type VoiceNoteState = 'idle' | 'starting' | 'recording';

export interface VoiceNote {
  wav: Uint8Array;
  durationMs: number;
}

export interface VoiceNoteRecorder {
  state: VoiceNoteState;
  elapsedMs: number;
  level: number;
  /** Why the last hold produced nothing worth saying so; cleared by the next hold. */
  error: string | null;
  supported: boolean;
  /** The finger came down and held. */
  begin: () => Promise<void>;
  /** The finger lifted where it started: the note is handed to `onNote`. */
  release: () => void;
  /** The finger slid away, or the screen went: nothing is sent. */
  cancel: () => void;
}

export function useVoiceNote(onNote: (note: VoiceNote) => void): VoiceNoteRecorder {
  const [state, setStateRaw] = useState<VoiceNoteState>('idle');
  const [elapsedMs, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<VoiceNoteState>('idle');
  const onNoteRef = useRef(onNote);
  useEffect(() => {
    onNoteRef.current = onNote;
  });
  const take = useRef({ chunks: [] as Int16Array[], rate: SPEECH_RATE, samples: 0, levelAt: 0 });
  // A release that lands while the microphone is still opening: honoured once it has opened.
  const pending = useRef<'release' | 'cancel' | null>(null);
  const alive = useRef(true);

  const setState = useCallback((next: VoiceNoteState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  const stopRef = useRef<(send: boolean) => void>(() => {});

  const onBuffer = useCallback((buffer: MicBuffer) => {
    if (stateRef.current !== 'recording') return;
    const tk = take.current;
    tk.rate = buffer.sampleRate;
    tk.chunks.push(buffer.samples);
    tk.samples += buffer.samples.length;
    const ms = (tk.samples / buffer.sampleRate) * 1000;
    const now = Date.now();
    if (now - tk.levelAt >= LEVEL_EVERY_MS) {
      tk.levelAt = now;
      setLevel(orbLevel(rms(buffer.samples)));
      setElapsed(ms);
    }
    if (ms >= VOICE_NOTE_MAX_MS) stopRef.current(true);
  }, []);

  const mic = useMicStream(onBuffer);
  const micRef = useRef(mic);
  useEffect(() => {
    micRef.current = mic;
  }, [mic]);

  const stop = useCallback(
    (send: boolean) => {
      if (stateRef.current === 'idle') return;
      if (stateRef.current === 'starting') {
        pending.current = send ? 'release' : 'cancel';
        return;
      }
      micRef.current.stop();
      void endVoiceSession().catch(() => undefined);
      const tk = take.current;
      const durationMs = (tk.samples / tk.rate) * 1000;
      const chunks = tk.chunks;
      take.current = { chunks: [], rate: SPEECH_RATE, samples: 0, levelAt: 0 };
      setState('idle');
      setLevel(0);
      setElapsed(0);
      if (!send) {
        void reject();
        return;
      }
      if (durationMs < VOICE_NOTE_MIN_MS) {
        setError(i18n.t('chat.voiceNote.tooShort'));
        void reject();
        return;
      }
      const samples = downsample(concatSamples(chunks), tk.rate);
      void confirm();
      onNoteRef.current({ wav: encodeWav(samples, tk.rate >= SPEECH_RATE ? SPEECH_RATE : tk.rate), durationMs });
    },
    [setState],
  );
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const begin = useCallback(async () => {
    if (stateRef.current !== 'idle') return;
    setError(null);
    pending.current = null;
    setState('starting');
    const permission = await requestMicrophone();
    if (!alive.current) return;
    if (!permission.granted) {
      setState('idle');
      setError(
        i18n.t(!voiceSupported() ? 'chat.voice.needsUpdate' : permission.canAskAgain ? 'chat.voice.micDenied' : 'chat.voice.micBlocked'),
      );
      return;
    }
    // The prompt took the touch with it: the finger that asked has long lifted.
    if (pending.current) {
      pending.current = null;
      setState('idle');
      return;
    }
    try {
      await beginVoiceSession();
      take.current = { chunks: [], rate: SPEECH_RATE, samples: 0, levelAt: 0 };
      await micRef.current.start();
      if (!alive.current) return;
      setState('recording');
      void tap();
    } catch {
      setState('idle');
      setError(i18n.t('chat.voice.micFailed'));
      void endVoiceSession().catch(() => undefined);
      return;
    }
    const after = pending.current;
    pending.current = null;
    if (after) stop(after === 'release');
  }, [setState, stop]);

  const release = useCallback(() => stop(true), [stop]);
  const cancel = useCallback(() => stop(false), [stop]);

  useEffect(
    () => () => {
      alive.current = false;
      if (stateRef.current === 'recording') {
        micRef.current.stop();
        void endVoiceSession().catch(() => undefined);
      }
    },
    [],
  );

  return { state, elapsedMs, level, error, supported: voiceSupported(), begin, release, cancel };
}
