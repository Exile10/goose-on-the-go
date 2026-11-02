/**
 * Teaching the Pond how this person says the wake phrase. The Pond does not listen for this itself:
 * each take is recorded on the phone and uploaded, and the Pond keeps how its speech model heard it.
 * A Pond with its own "hey goose" detector also says, take by take, whether that detector heard it,
 * and which detector the room will use.
 */

import { useCallback, useRef, useState } from 'react';

import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { WakeDetectorVerdict } from '@/services/types';
import { calibrationPrompts } from '@/models/owner-setup';
import { describeApiError } from './describe-error';
import { useTakeRecorder, type TakeState } from './use-take-recorder';

export type CalibrationState = TakeState;

/** One take as the Pond heard it. */
export interface CalibrationResult {
  prompt: string;
  /** Whisper found the phrase in it. */
  phrase: boolean;
  /** The "hey goose" detector heard it; null on a Pond that does not run one. */
  detector: boolean | null;
}

export interface UseWakeCalibration {
  state: CalibrationState;
  /** The sentence to say now. */
  prompt: string | null;
  taken: number;
  target: number;
  /** The ways the Pond has now heard the phrase. */
  heard: string[];
  /** Each take of this run, in order. */
  results: CalibrationResult[];
  /** The detector the Pond chose from these takes, and why; null until a Pond that has one says. */
  detector: WakeDetectorVerdict | null;
  level: number;
  error: string | null;
  supported: boolean;
  start: () => Promise<void>;
  stop: () => void;
}

/** Why a take was refused, as a sentence that says what to do. */
export function describeCalibrationError(e: unknown): string {
  // A 422 is a take with no speech in it: the same sentence again, not a failure. A 502 is the
  // Pond's speech-to-text not answering, which no amount of trying again on this phone fixes.
  if (e instanceof ApiError && e.status === 422) return i18n.t('setup.wake.calibrate.nothingHeard');
  if (e instanceof ApiError && e.status === 502) return i18n.t('setup.wake.calibrate.noTranscriber');
  return describeApiError(e) ?? i18n.t('setup.wake.calibrate.failed');
}

/** Whether the detector heard the latest take: its count of heard takes went up with it. */
export function detectorHeardTake(before: WakeDetectorVerdict | null, after: WakeDetectorVerdict | undefined): boolean | null {
  if (!after) return null;
  const heardBefore = before && before.of < after.of ? before.heard : 0;
  return after.heard > heardBefore;
}

export function useWakeCalibration(phrase: string): UseWakeCalibration {
  const prompts = calibrationPrompts(phrase);
  const [taken, setTaken] = useState(0);
  const [target, setTarget] = useState(prompts.length);
  const [heard, setHeard] = useState<string[]>([]);
  const [results, setResults] = useState<CalibrationResult[]>([]);
  const [detector, setDetector] = useState<WakeDetectorVerdict | null>(null);
  // The phrase is fixed for a mount: the step remounts this when it changes.
  const promptsRef = useRef(prompts);
  const takenRef = useRef(0);
  const detectorRef = useRef<WakeDetectorVerdict | null>(null);
  const finished = useRef(false);

  const recorder = useTakeRecorder({
    name: 'calibration',
    describe: describeCalibrationError,
    take: async (uri) => {
      const prompt = promptsRef.current[takenRef.current] ?? promptsRef.current[0];
      const result = await api.calibrateWakeWord(uri, prompt);
      const byDetector = detectorHeardTake(detectorRef.current, result.wake_detector);
      detectorRef.current = result.wake_detector ?? null;
      takenRef.current = result.sample_count;
      setTaken(result.sample_count);
      setTarget(result.target_count);
      setHeard(result.all_variants);
      setDetector(result.wake_detector ?? null);
      setResults((was) => [...was, { prompt, phrase: result.heard !== null, detector: byDetector }]);
      const done = result.complete || result.sample_count >= promptsRef.current.length;
      finished.current = done;
      return done ? 'done' : 'again';
    },
  });

  const start = useCallback(
    () =>
      recorder.start(async () => {
        // A fresh run clears what an earlier one taught, which may have been for another phrase.
        if (takenRef.current !== 0 && !finished.current) return;
        await api.resetWakeWordCalibration();
        await api.updateSettings({ voice_wake_word: phrase.trim() });
        takenRef.current = 0;
        detectorRef.current = null;
        finished.current = false;
        setTaken(0);
        setHeard([]);
        setResults([]);
        setDetector(null);
      }),
    [phrase, recorder],
  );

  const { state } = recorder;
  const prompt = state === 'idle' && taken === 0 ? null : prompts[Math.min(taken, prompts.length - 1)] ?? null;
  return {
    state,
    prompt,
    taken,
    target,
    heard,
    results,
    detector,
    level: recorder.level,
    error: recorder.error,
    supported: recorder.supported,
    start,
    stop: recorder.stop,
  };
}
