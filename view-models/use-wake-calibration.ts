/**
 * Teaching the Pond how this person says the wake phrase. The Pond does not listen for this itself:
 * each take is recorded on the phone and uploaded, and the Pond keeps how its speech model heard it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, api } from '@/services/api-client';
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
import { calibrationPrompts } from '@/models/owner-setup';
import { describeApiError } from './describe-error';

/** A take is one short sentence; past this nobody is still saying it. */
const TAKE_MS = 8_000;
/** Kept from before speech is detected, so the phrase's first syllable is not clipped. */
const PREROLL_MS = 300;
const LEVEL_EVERY_MS = 60;

export type CalibrationState = 'idle' | 'listening' | 'recording' | 'sending' | 'done' | 'error';

export interface UseWakeCalibration {
  state: CalibrationState;
  /** The sentence to say now. */
  prompt: string | null;
  taken: number;
  target: number;
  /** The ways the Pond has now heard the phrase. */
  heard: string[];
  level: number;
  error: string | null;
  supported: boolean;
  start: () => Promise<void>;
  stop: () => void;
}

export function useWakeCalibration(phrase: string): UseWakeCalibration {
  const prompts = calibrationPrompts(phrase);
  const [state, setStateRaw] = useState<CalibrationState>('idle');
  const [taken, setTaken] = useState(0);
  const [target, setTarget] = useState(prompts.length);
  const [heard, setHeard] = useState<string[]>([]);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<CalibrationState>('idle');
  const alive = useRef(true);
  // The phrase is fixed for a mount: the step remounts this when it changes.
  const promptsRef = useRef(prompts);
  const takenRef = useRef(0);
  const take = useRef({ chunks: [] as Int16Array[], rate: SPEECH_RATE, started: false, loudSince: 0, quietSince: 0, since: 0, levelAt: 0 });
  const finishRef = useRef<(heardSpeech: boolean) => void>(() => {});

  const setState = useCallback((next: CalibrationState) => {
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
    (next: CalibrationState) => {
      micRef.current.stop();
      setLevel(0);
      setState(next);
      void endVoiceSession().catch(() => undefined);
    },
    [setState],
  );

  const finish = useCallback((heardSpeech: boolean) => {
    if (stateRef.current !== 'listening' && stateRef.current !== 'recording') return;
    const tk = take.current;
    micRef.current.stop();
    setLevel(0);
    if (!heardSpeech || !tk.started) {
      setError(i18n.t('setup.wake.calibrate.nothingHeard'));
      end('error');
      return;
    }
    setState('sending');
    const samples = downsample(concatSamples(tk.chunks), tk.rate);
    tk.chunks = [];
    const uri = cacheFile('calibration', encodeWav(samples, tk.rate >= SPEECH_RATE ? SPEECH_RATE : tk.rate));
    const prompt = promptsRef.current[takenRef.current] ?? promptsRef.current[0];
    void api
      .calibrateWakeWord(uri, prompt)
      .then(async (result) => {
        if (!alive.current) return;
        takenRef.current = result.sample_count;
        setTaken(result.sample_count);
        setTarget(result.target_count);
        setHeard(result.all_variants);
        if (result.complete || result.sample_count >= promptsRef.current.length) {
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
        // A 422 is a take with no speech in it: the same sentence again, not a failure. A 502 is the
        // Pond's speech-to-text not answering, which no amount of trying again on this phone fixes.
        setError(
          e instanceof ApiError && e.status === 422
            ? i18n.t('setup.wake.calibrate.nothingHeard')
            : e instanceof ApiError && e.status === 502
              ? i18n.t('setup.wake.calibrate.noTranscriber')
              : describeApiError(e) ?? i18n.t('setup.wake.calibrate.failed'),
        );
        end('error');
      })
      .finally(() => discardFile(uri));
  }, [end, listen, setState]);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  const start = useCallback(async () => {
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
      // A fresh run clears what an earlier one taught, which may have been for another phrase.
      if (takenRef.current === 0 || stateRef.current === 'done') {
        await api.resetWakeWordCalibration();
        await api.updateSettings({ voice_wake_word: phrase.trim() });
        takenRef.current = 0;
        setTaken(0);
        setHeard([]);
      }
      await beginVoiceSession();
    } catch (e) {
      setError(describeApiError(e) ?? i18n.t('setup.wake.calibrate.failed'));
      setState('error');
      return;
    }
    if (alive.current) await listen();
  }, [listen, phrase, setState]);

  const stop = useCallback(() => end('idle'), [end]);

  useEffect(
    () => () => {
      alive.current = false;
      micRef.current.stop();
      void endVoiceSession().catch(() => undefined);
    },
    [],
  );

  const prompt = state === 'idle' && taken === 0 ? null : prompts[Math.min(taken, prompts.length - 1)] ?? null;
  return { state, prompt, taken, target, heard, level, error, supported: voiceSupported(), start, stop };
}
