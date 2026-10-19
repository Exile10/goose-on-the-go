/**
 * Problems — the Pond's own warnings and errors, from its operational log
 * (`GET /logs`), for the Activity screen's Problems filter (issue #15).
 *
 * Read only while that filter is open: the log is a separate store from
 * activity, and nobody looking at Home events needs it polled behind them.
 *
 * Behind the Developer toggle for `logs`, like the rest of the screen.
 */

import { useCallback, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import type { LogEntry } from '@/services/types';
import { SAMPLE_PROBLEMS, isProblem } from '@/models/log';
import { ACTIVITY_MS, describeActivityError } from './use-activity';
import { useLive } from './use-live';

/** Rows read per poll, before INFO is dropped. The Pond allows 2000. */
export const PROBLEMS_LIMIT = 200;

export interface UseProblems {
  data: { problems: LogEntry[] };
  loading: boolean;
  error: string | null;
  /** A read failed before any landed: the list is unknown, not empty, so it must not read "No problems". */
  failed: boolean;
  actions: { refresh: () => Promise<void> };
}

/** `open` is whether the Problems filter is showing; nothing is read while it is not. */
export function useProblems(open: boolean): UseProblems {
  const { hydrated, isScreenReal } = useServer();
  const real = isScreenReal('logs');

  const [problems, setProblems] = useState<LogEntry[]>(() => (real ? [] : SAMPLE_PROBLEMS));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // The Developer toggle swapping the source; see useActivity.
  const [source, setSource] = useState(real);
  if (source !== real) {
    setSource(real);
    setProblems(real ? [] : SAMPLE_PROBLEMS);
    setError(null);
    setFailed(false);
  }

  const loadedFrom = useRef<boolean | null>(null);

  const load = useCallback(
    async (loud: boolean) => {
      if (!real) return;
      // The first read of a source shows a spinner; polls after it do not.
      if (loud || loadedFrom.current !== real) {
        setLoading(true);
        setError(null);
        setFailed(false);
      }
      try {
        const rows = await api.listLogs({ limit: PROBLEMS_LIMIT });
        setProblems(rows.filter(isProblem));
        loadedFrom.current = real;
        setError(null);
        setFailed(false);
      } catch (e) {
        if (loadedFrom.current !== real) setFailed(true);
        if (loud || loadedFrom.current !== real) setError(describeActivityError(e));
        else console.warn('[problems] refresh failed; showing the last result', e instanceof ApiError ? e.status : 'network');
      } finally {
        setLoading(false);
      }
    },
    [real],
  );

  const refresh = useCallback(() => load(true), [load]);

  useLive(() => load(false), ACTIVITY_MS, hydrated && real && open);

  return { data: { problems }, loading, error, failed, actions: { refresh } };
}
