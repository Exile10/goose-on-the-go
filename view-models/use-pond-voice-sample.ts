/**
 * Hearing a voice during setup, on the Pond's own speaker (P4's `POST /voice/sample`), since a Pond
 * plays nothing to a phone until it is set up. Null on an older Pond without the route, so the picker
 * says no sample can be played instead of offering a button that cannot work.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCountdown } from '@/hooks/use-countdown';
import { ApiError, api } from '@/services/api-client';
import type { PreviewState, VoicePreview } from './use-voice-preview';

// How long "playing on your Pond" stays up: the Pond does not say when its sample ends.
const SAID_MS = 4_000;

export function usePondVoiceSample(voice: string): VoicePreview | null {
  const { t } = useTranslation();
  const [supported, setSupported] = useState(true);
  const [state, setState] = useState<PreviewState>('idle');
  const [said, setSaid] = useState(false);
  const [problem, setProblem] = useState<'unknown' | 'unavailable' | 'other' | null>(null);
  const { left: waitSecs, start: startWait } = useCountdown();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(voice);
  useEffect(() => {
    latest.current = voice;
  }, [voice]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const play = useCallback(async () => {
    if (waitSecs > 0) return;
    if (timer.current) clearTimeout(timer.current);
    setState('loading');
    setSaid(false);
    setProblem(null);
    try {
      await api.voiceSample(latest.current);
      setState('idle');
      setSaid(true);
      timer.current = setTimeout(() => setSaid(false), SAID_MS);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && e.detail !== 'unknown_voice') {
        setSupported(false);
        setState('idle');
        return;
      }
      if (e instanceof ApiError && e.status === 429) startWait(e.retryAfterSecs && e.retryAfterSecs > 0 ? e.retryAfterSecs : 5);
      setProblem(
        e instanceof ApiError && e.detail === 'unknown_voice'
          ? 'unknown'
          : e instanceof ApiError && (e.status === 503 || e.detail === 'voice_unavailable')
            ? 'unavailable'
            : e instanceof ApiError && e.status === 429
              ? null
              : 'other',
      );
      setState(e instanceof ApiError && e.status === 429 ? 'idle' : 'error');
    }
  }, [startWait, waitSecs]);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setSaid(false);
    setState('idle');
  }, []);

  const error =
    waitSecs > 0
      ? t('setup.personality.sampleWait', { count: waitSecs })
      : problem === 'unknown'
        ? t('setup.personality.sampleUnknown')
        : problem === 'unavailable'
          ? t('setup.personality.sampleUnavailable')
          : problem === 'other'
            ? t('setup.personality.sampleFailed')
            : null;

  if (!supported) return null;
  return {
    state,
    busy: state === 'loading',
    error,
    statement: said ? t('setup.personality.samplePlaying') : t('setup.personality.sampleHint'),
    level: 0,
    play,
    stop,
  };
}
