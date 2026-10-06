/**
 * Activity — what the Pond has recorded happening, newest first (issue #15).
 *
 * The Pond has no stream for activity, so this polls. One read covers every
 * filter: the screen narrows it on the phone, because a filter spans several
 * categories and the Pond takes only one per request.
 *
 * Behind the Developer toggle for `logs`: on mock, `SAMPLE_ACTIVITY`.
 */

import { useCallback, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import type { ActivityEvent } from '@/services/types';
import { SAMPLE_ACTIVITY } from '@/models/log';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';

/** Activity is read while the screen is open; half a minute keeps it current without crowding the Pond. */
export const ACTIVITY_MS = 30_000;
/** How far back one read goes. The Pond allows up to 1000; a phone screen does not need them. */
export const ACTIVITY_LIMIT = 200;

export interface UseActivity {
  data: { events: ActivityEvent[] };
  loading: boolean;
  error: string | null;
  actions: {
    refresh: () => Promise<void>;
    /** Delete every event on the Pond, then read again; resolves to how many went. Throws if the Pond refuses. */
    clear: () => Promise<number>;
  };
}

export function useActivity(): UseActivity {
  const { hydrated, isScreenReal } = useServer();
  const real = isScreenReal('logs');

  const [events, setEvents] = useState<ActivityEvent[]>(() => (real ? [] : SAMPLE_ACTIVITY));
  const [loading, setLoading] = useState(real);
  const [error, setError] = useState<string | null>(null);

  // The Developer toggle swapping the source under a mounted screen. Reset
  // while rendering rather than in an effect that would paint the old one first.
  const [source, setSource] = useState(real);
  if (source !== real) {
    setSource(real);
    setEvents(real ? [] : SAMPLE_ACTIVITY);
    setLoading(real);
    setError(null);
  }

  // Which source last loaded, so the first failure of a new one is reported.
  const loadedFrom = useRef<boolean | null>(null);

  /** `loud` is a read somebody asked for; a poll is quiet and keeps the last good data. */
  const load = useCallback(
    async (loud: boolean) => {
      if (!real) return;
      if (loud) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await api.listActivity({ limit: ACTIVITY_LIMIT });
        setEvents(res.events ?? []);
        loadedFrom.current = real;
        setError(null);
      } catch (e) {
        if (loud || loadedFrom.current !== real) setError(describeApiError(e));
        else console.warn('[activity] refresh failed; showing the last result', e instanceof ApiError ? e.status : 'network');
      } finally {
        setLoading(false);
      }
    },
    [real],
  );

  const refresh = useCallback(() => load(true), [load]);

  const clear = useCallback(async () => {
    // On mock there is no Pond to ask: the samples go, until the toggle brings them back.
    if (!real) {
      setEvents([]);
      return SAMPLE_ACTIVITY.length;
    }
    const { purged } = await api.clearActivity();
    setEvents([]);
    await load(true);
    return purged;
  }, [real, load]);

  useLive(() => load(false), ACTIVITY_MS, hydrated && real);

  return { data: { events }, loading, error, actions: { refresh, clear } };
}
