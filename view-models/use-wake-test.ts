/**
 * The wake test (app/(stack)/wake-test.tsx): the phrase said ten times, then a minute of ordinary
 * talk, each recorded and run through the listening service's own pipeline (`runWakeTest`). It
 * reports how many of the ten woke the phone and how many times the talk did, and offers the
 * "hey goose" line the phrase part suggests. The recordings are deleted once scored.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { falseWakes, PHRASE_TIMES, scorePhrase, suggestedLine, type PhraseScore, type ResolvedCandidate } from '@/models/wake-test';
import i18n from '@/services/i18n';
import type { PhoneVoices } from '@/services/phone-wake';
import { chooseWakeLine, phoneVoices, runWakeTest } from '@/services/phone-wake-voices';
import { SPEECH_RATE, concatSamples, downsample, encodeWav } from '@/services/speech';
import {
  beginVoiceSession,
  cacheFile,
  discardFile,
  endVoiceSession,
  requestMicrophone,
  useMicStream,
  type MicBuffer,
} from '@/services/voice-io';

/** The phrase part ends when the person says so, or after this. */
const PHRASE_MAX_MS = 60_000;
/** The talking part. */
export const TALK_MS = 60_000;

export type WakeTestPhase = 'intro' | 'phrase' | 'talk' | 'scoring' | 'done' | 'error';

export interface WakeTestResult {
  phrase: PhraseScore;
  /** Times the talk would have opened the orb. */
  falseWakes: number;
  /** The "hey goose" line the phrase part suggests; null when it would not move. */
  line: number | null;
  /** The line the test ran with. */
  cnn: number;
}

export interface UseWakeTest {
  phase: WakeTestPhase;
  /** What the voice check knows here; null until read, or where the phone cannot listen. */
  voices: PhoneVoices | null;
  /** Milliseconds left in the talking part. */
  left: number;
  result: WakeTestResult | null;
  error: string | null;
  /** Whether the suggested line was kept. */
  kept: boolean;
  actions: {
    start: () => Promise<void>;
    /** The phrase part is done: on to the talking part. */
    next: () => void;
    keepLine: () => Promise<void>;
    resetLine: () => Promise<void>;
    again: () => void;
  };
}

export function useWakeTest(): UseWakeTest {
  const [phase, setPhaseRaw] = useState<WakeTestPhase>('intro');
  const [voices, setVoices] = useState<PhoneVoices | null>(null);
  const [left, setLeft] = useState(TALK_MS);
  const [result, setResult] = useState<WakeTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const phaseRef = useRef<WakeTestPhase>('intro');
  const rec = useRef({ chunks: [] as Int16Array[], rate: SPEECH_RATE, since: 0 });
  const recordings = useRef<{ phrase: string | null; talk: string | null }>({ phrase: null, talk: null });
  const alive = useRef(true);

  const setPhase = useCallback((next: WakeTestPhase) => {
    phaseRef.current = next;
    setPhaseRaw(next);
  }, []);

  const reload = useCallback(async () => {
    const next = await phoneVoices();
    if (alive.current) setVoices(next);
    return next;
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const onBuffer = useCallback((buffer: MicBuffer) => {
    if (phaseRef.current !== 'phrase' && phaseRef.current !== 'talk') return;
    rec.current.rate = buffer.sampleRate;
    rec.current.chunks.push(buffer.samples);
  }, []);
  const mic = useMicStream(onBuffer);
  const micRef = useRef(mic);
  useEffect(() => {
    micRef.current = mic;
  }, [mic]);

  /** The part recorded so far, as a WAV in the cache; the buffers are let go. */
  const cut = useCallback(() => {
    const r = rec.current;
    const samples = downsample(concatSamples(r.chunks), r.rate);
    rec.current = { chunks: [], rate: r.rate, since: Date.now() };
    return cacheFile('wake-test', encodeWav(samples, r.rate >= SPEECH_RATE ? SPEECH_RATE : r.rate));
  }, []);

  const fail = useCallback(
    (words: string, e?: unknown) => {
      if (e !== undefined) console.warn('[wake] the wake test failed', { kind: 'phone_wake_test', error: String(e) });
      micRef.current.stop();
      void endVoiceSession().catch(() => undefined);
      setError(words);
      setPhase('error');
    },
    [setPhase],
  );

  const score = useCallback(async () => {
    micRef.current.stop();
    void endVoiceSession().catch(() => undefined);
    setPhase('scoring');
    const { phrase, talk } = recordings.current;
    try {
      if (!phrase || !talk) throw new Error('a part of the test was not recorded');
      const said: ResolvedCandidate[] = await runWakeTest(phrase);
      const chatter: ResolvedCandidate[] = await runWakeTest(talk);
      const known = (await reload()) ?? voices;
      if (!alive.current) return;
      const next: WakeTestResult = {
        phrase: scorePhrase(said, PHRASE_TIMES),
        falseWakes: falseWakes(chatter),
        line: known ? suggestedLine(said, known) : null,
        cnn: known?.cnn ?? 0,
      };
      console.info('[wake] wake test scored', {
        kind: 'phone_wake_test',
        caught: next.phrase.caught,
        falseWakes: next.falseWakes,
        line: next.line,
        cnn: next.cnn,
      });
      setResult(next);
      setPhase('done');
    } catch (e) {
      fail(i18n.t('wakeTest.failed'), e);
    } finally {
      if (phrase) discardFile(phrase);
      if (talk) discardFile(talk);
      recordings.current = { phrase: null, talk: null };
    }
  }, [fail, reload, setPhase, voices]);

  // The phrase part's cap, and the talking part's countdown.
  useEffect(() => {
    if (phase !== 'phrase' && phase !== 'talk') return;
    const timer = setInterval(() => {
      const spent = Date.now() - rec.current.since;
      if (phaseRef.current === 'phrase' && spent >= PHRASE_MAX_MS) {
        recordings.current.phrase = cut();
        setPhase('talk');
        return;
      }
      if (phaseRef.current === 'talk') {
        setLeft(Math.max(0, TALK_MS - spent));
        if (spent >= TALK_MS) {
          recordings.current.talk = cut();
          void score();
        }
      }
    }, 250);
    return () => clearInterval(timer);
  }, [cut, phase, score, setPhase]);

  const start = useCallback(async () => {
    setError(null);
    setResult(null);
    setKept(false);
    const permission = await requestMicrophone();
    if (!permission.granted) {
      fail(i18n.t(permission.canAskAgain ? 'chat.voice.micDenied' : 'chat.voice.micBlocked'));
      return;
    }
    try {
      await beginVoiceSession();
      rec.current = { chunks: [], rate: SPEECH_RATE, since: Date.now() };
      setLeft(TALK_MS);
      setPhase('phrase');
      await micRef.current.start();
    } catch (e) {
      fail(i18n.t('chat.voice.micFailed'), e);
    }
  }, [fail, setPhase]);

  const next = useCallback(() => {
    if (phaseRef.current !== 'phrase') return;
    recordings.current.phrase = cut();
    setPhase('talk');
  }, [cut, setPhase]);

  const keepLine = useCallback(async () => {
    if (!result?.line) return;
    if (await chooseWakeLine(result.line)) setKept(true);
    else setError(i18n.t('wakeTest.keepFailed'));
    await reload();
  }, [reload, result]);

  const resetLine = useCallback(async () => {
    if (!(await chooseWakeLine(null))) setError(i18n.t('wakeTest.keepFailed'));
    await reload();
  }, [reload]);

  const again = useCallback(() => {
    setResult(null);
    setKept(false);
    setError(null);
    setPhase('intro');
  }, [setPhase]);

  useEffect(
    () => () => {
      alive.current = false;
      micRef.current.stop();
      void endVoiceSession().catch(() => undefined);
      const { phrase, talk } = recordings.current;
      if (phrase) discardFile(phrase);
      if (talk) discardFile(talk);
    },
    [],
  );

  return { phase, voices, left, result, error, kept, actions: { start, next, keepLine, resetLine, again } };
}
