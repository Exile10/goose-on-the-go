/**
 * Activity — what the Pond has recorded happening, newest first (issue #15).
 *
 * The Pond has no stream for activity, so this polls, and reads for the filter
 * on screen. The Pond takes one category per request, so a filter spanning
 * several asks once for each and merges them: one read of everything, narrowed
 * on the phone, let the busiest categories -- an outbound call, a sensor
 * reading -- push every other one out of the window.
 *
 * Behind the Developer toggle for `logs`: on mock, `SAMPLE_ACTIVITY`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import type { ActivityEvent } from '@/services/types';
import { SAMPLE_ACTIVITY, categoriesOf, inFilter, newestFirst, type ActivityFilter } from '@/models/log';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';

/** Activity is read while the screen is open; half a minute keeps it current without crowding the Pond. */
export const ACTIVITY_MS = 30_000;
/** How far back one read goes, per category and once merged. The Pond allows up to 1000; a phone screen does not need them. */
export const ACTIVITY_LIMIT = 200;

export interface UseActivity {
  data: { events: ActivityEvent[] };
  loading: boolean;
  error: string | null;
  /** A read failed before any landed for this filter: the list is unknown, not empty. */
  failed: boolean;
  actions: {
    refresh: () => Promise<void>;
    /** Delete every event on the Pond, then read again; resolves to how many went. Throws if the Pond refuses. */
    clear: () => Promise<number>;
  };
}

/** The newest events under `filter`: everything in one request, or one per category it spans. */
async function readActivity(filter: ActivityFilter): Promise<ActivityEvent[]> {
  if (filter === 'all') return (await api.listActivity({ limit: ACTIVITY_LIMIT })).events ?? [];
  const reads = await Promise.all(
    categoriesOf(filter).map((category) => api.listActivity({ limit: ACTIVITY_LIMIT, category })),
  );
  // The agent category also carries presence and session events, which Actions leaves out.
  const events = reads.flatMap((r) => r.events ?? []).filter((e) => inFilter(e, filter));
  return newestFirst(events, ACTIVITY_LIMIT);
}

const sampleFor = (filter: ActivityFilter) => SAMPLE_ACTIVITY.filter((e) => inFilter(e, filter));

export function useActivity(filter: ActivityFilter): UseActivity {
  const { hydrated, isScreenReal } = useServer();
  const real = isScreenReal('logs');

  const [events, setEvents] = useState<ActivityEvent[]>(() => (real ? [] : sampleFor(filter)));
  const [loading, setLoading] = useState(real);
  const [error, setError] = useState<string | null>(null);
  // Whether a read has landed for this source and filter, so the first failure of a new one is
  // reported, and whether one failed before any did.
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // The Developer toggle swapping the source, or the filter changing, under a mounted screen.
  // Reset while rendering rather than in an effect that would paint the old list first.
  const [source, setSource] = useState({ real, filter });
  if (source.real !== real || source.filter !== filter) {
    setSource({ real, filter });
    setEvents(real ? [] : sampleFor(filter));
    setLoading(real);
    setError(null);
    setLoaded(false);
    setFailed(false);
  }

  // Each read's number. Only the latest may land: a poll still out when the filter changes
  // would otherwise put the old filter's events under the new one.
  const latest = useRef(0);

  /** `loud` is a read somebody asked for; a poll is quiet and keeps the last good data. */
  const load = useCallback(
    async (loud: boolean) => {
      if (!real) return;
      const mine = ++latest.current;
      if (loud) {
        setLoading(true);
        setError(null);
        setFailed(false);
      }
      try {
        const next = await readActivity(filter);
        if (mine !== latest.current) return;
        setEvents(next);
        setLoaded(true);
        setFailed(false);
        setError(null);
      } catch (e) {
        if (mine !== latest.current) return;
        if (!loaded) setFailed(true);
        if (loud || !loaded) setError(describeApiError(e));
        else console.warn('[activity] refresh failed; showing the last result', e instanceof ApiError ? e.status : 'network');
      } finally {
        if (mine === latest.current) setLoading(false);
      }
    },
    [real, filter, loaded],
  );

  const refresh = useCallback(() => load(true), [load]);

  const clear = useCallback(async () => {
    // On mock there is no Pond to ask: the samples go, until the toggle or another filter
    // brings them back.
    if (!real) {
      setEvents([]);
      return SAMPLE_ACTIVITY.length;
    }
    const { purged } = await api.clearActivity();
    setEvents([]);
    await load(true);
    return purged;
  }, [real, load]);

  // A new filter is a new question, asked at once rather than at the poll's next tick. The poll
  // asks it from then on, since it always calls the latest `load`.
  const askedFor = useRef(filter);
  useEffect(() => {
    if (askedFor.current === filter) return;
    askedFor.current = filter;
    // Whatever is still out was asked of the old filter. The new read starts on a microtask,
    // as `useLive` starts its own, so this effect does not set state synchronously.
    latest.current++;
    if (hydrated && real) void Promise.resolve().then(() => load(false));
  }, [filter, hydrated, real, load]);

  useLive(() => load(false), ACTIVITY_MS, hydrated && real);

  return { data: { events }, loading, error, failed, actions: { refresh, clear } };
}
