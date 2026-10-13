/**
 * Today — how much the Pond recorded in the last day, by filter, for the strip
 * above the Activity list (issue #15). From `GET /activity/summary?window=day`.
 *
 * The strip is a glance, not a record: a poll that fails keeps the last
 * counts, and a first read that fails hides the strip rather than showing an
 * error above the list's own.
 *
 * Behind the Developer toggle for `logs`: on mock, `SAMPLE_SUMMARY`.
 */

import { useCallback, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import type { ActivitySummary } from '@/services/types';
import { SAMPLE_SUMMARY } from '@/models/log';
import { useLive } from './use-live';

/** A day's counts move slowly; once a minute is plenty. */
export const SUMMARY_MS = 60_000;

export interface UseActivitySummary {
  /** `null` until the first read lands, or when it failed. */
  data: { summary: ActivitySummary | null };
}

export function useActivitySummary(): UseActivitySummary {
  const { hydrated, isScreenReal } = useServer();
  const real = isScreenReal('logs');

  const [summary, setSummary] = useState<ActivitySummary | null>(() => (real ? null : SAMPLE_SUMMARY));

  // The Developer toggle swapping the source; see useActivity.
  const [source, setSource] = useState(real);
  if (source !== real) {
    setSource(real);
    setSummary(real ? null : SAMPLE_SUMMARY);
  }

  const load = useCallback(async () => {
    if (!real) return;
    try {
      setSummary(await api.activitySummary('day'));
    } catch (e) {
      console.warn('[activity-summary] read failed; keeping the last counts', e instanceof ApiError ? e.status : 'network');
    }
  }, [real]);

  useLive(load, SUMMARY_MS, hydrated && real);

  return { data: { summary } };
}
