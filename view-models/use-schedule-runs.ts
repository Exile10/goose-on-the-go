/**
 * One schedule's run history, for its detail screen.
 *
 * Read when the screen opens, and again whenever `version` changes: the
 * detail screen bumps it when a run it watched finishes, which is the only
 * time the history grows while somebody is looking at it.
 */

import { useEffect, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import type { ScheduleRun } from '@/services/types';
import { describeScheduleError } from './use-schedules';

export const RUNS_LIMIT = 10;

export interface UseScheduleRuns {
  data: { runs: ScheduleRun[] };
  loading: boolean;
  error: string | null;
  /**
   * The read failed, so the history is unknown rather than empty. `error` can
   * be null even so: an unreachable or refused Pond is the banner's to describe.
   */
  failed: boolean;
}

/** `scheduleId` null means there is no schedule to read, and nothing is read. */
export function useScheduleRuns(scheduleId: string | null, version = 0): UseScheduleRuns {
  const { hydrated, isScreenReal } = useServer();
  // The samples have never run, and an empty history is the honest mock.
  const reading = scheduleId && hydrated && isScreenReal('schedule') ? scheduleId : null;

  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // A different schedule starts empty, not showing the last one's runs.
  const [shown, setShown] = useState<string | null>(null);
  if (shown !== reading) {
    setShown(reading);
    setRuns([]);
    setError(null);
    setFailed(false);
    setLoading(reading != null);
  }

  useEffect(() => {
    if (!reading) return;
    let current = true;
    api
      .listScheduleRuns(reading, RUNS_LIMIT)
      .then((list) => {
        if (!current) return;
        setRuns(list);
        setFailed(false);
      })
      .catch((e: unknown) => {
        if (!current) return;
        setError(describeScheduleError(e));
        setFailed(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [reading, version]);

  return { data: { runs }, loading, error, failed };
}
