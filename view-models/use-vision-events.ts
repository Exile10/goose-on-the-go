/**
 * Vision events -- what the Pond's camera saw, and which of it somebody has looked at.
 *
 * The Pond lists one camera per read (`GET /api/v1/camera/events?camera_id=`) and has no read
 * across cameras, so the screen asks for the camera the Pond's settings name
 * (`vision_camera_id`): the one its vision pipeline stamps on everything it records. Until the
 * settings arrive that name is unknown, and nothing is read.
 *
 * New events arrive over `GET /vision/events/stream` while the screen is in front, and the 30
 * second poll is what is left when that stream is not open: before it connects, after it drops,
 * and on a Pond that has no such route. A stream that opens reads the list once more, so what
 * came in during the gap is not lost. Acknowledging is one `PATCH` per event: the Pond offers no
 * "acknowledge all" and no delete, so neither does this. Filters apply to what was read, because
 * the Pond filters nothing.
 *
 * Real Pond only, like Devices: there is no Developer toggle and no sample data behind it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { CameraEvent } from '@/services/types';
import { matchesFilter, unacknowledgedCount, type EventFilter } from '@/models/vision';
import { describeApiError, refusalReason } from './describe-error';
import { useLive } from './use-live';
import { useScreenActive } from './use-screen-active';

export { unacknowledgedCount };

/** What is left of live arrivals when the stream is not open. */
export const VISION_EVENTS_MS = 30_000;

/** How many to ask for: the most the Pond gives, so a filter has something to find. */
export const VISION_EVENTS_LIMIT = 100;

/** A stream that dropped after it was open comes back this soon, and one that never opened backs off from it. */
export const STREAM_RETRY_MS = 2_000;
export const STREAM_RETRY_MAX_MS = 60_000;

export interface UseVisionEvents {
  data: {
    events: CameraEvent[];
    /** `events` under the chosen filter. */
    shown: CameraEvent[];
    /** How many of `events` nobody has acknowledged yet. */
    unacknowledged: number;
    filter: EventFilter;
  };
  /** New events are arriving as they happen; otherwise the list is read every 30 seconds. */
  live: boolean;
  /** Privacy refuses the stream, so no new event will arrive until cameras are switched back on. */
  streamBlocked: boolean;
  loading: boolean;
  error: string | null;
  /** A load failed and nothing has loaded yet: unknown, not empty. See useSchedules. */
  failed: boolean;
  /** Ids with an acknowledgement on its way to the Pond. */
  acknowledging: ReadonlySet<number>;
  actions: {
    refresh: () => Promise<void>;
    acknowledge: (event: CameraEvent) => Promise<void>;
    setFilter: (filter: EventFilter) => void;
  };
}

/** An event the stream delivered, put at the top; one already held is kept as it is, since the list may know more. */
export function mergeEvent(list: readonly CameraEvent[], event: CameraEvent, limit = VISION_EVENTS_LIMIT): CameraEvent[] {
  if (list.some((e) => e.id === event.id)) return [...list];
  return [event, ...list].slice(0, limit);
}

export interface StreamHandlers {
  onEvent: (event: CameraEvent) => void;
  /** Called with true once the Pond has accepted the stream, and false whenever it ends. */
  onLive: (live: boolean) => void;
  /** Called with true when Privacy refuses the stream, and false once it opens. */
  onBlocked: (blocked: boolean) => void;
}

/**
 * Keep the event stream open until the returned function is called, opening it again whenever it
 * ends. The backoff is for a Pond that is not answering, and the poll covers the gap.
 */
export function openVisionStream(handlers: StreamHandlers, retryMs = STREAM_RETRY_MS): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  let backoff = retryMs;
  let reopen: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    reopen = null;
    let opened = false;
    void (async () => {
      let refused: 'unsupported' | 'blocked' | null = null;
      try {
        await api.streamVisionEvents(handlers.onEvent, signal, () => {
          opened = true;
          backoff = retryMs;
          handlers.onBlocked(false);
          handlers.onLive(true);
        });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) refused = 'unsupported';
        else if (e instanceof ApiError && e.status === 403 && refusalReason(e) === 'cameras_disabled') refused = 'blocked';
      }
      if (signal.aborted) return;
      handlers.onLive(false);
      // No such route: nothing to ask again for, and the poll has the list.
      if (refused === 'unsupported') return;
      if (refused === 'blocked') {
        handlers.onBlocked(true);
        backoff = STREAM_RETRY_MAX_MS;
      }
      // One that was open and dropped is back at once; one that never opened waits longer each time.
      const wait = opened ? retryMs : backoff;
      backoff = Math.min(backoff * 2, STREAM_RETRY_MAX_MS);
      reopen = setTimeout(open, wait);
    })();
  };
  open();

  return () => {
    controller.abort();
    if (reopen) clearTimeout(reopen);
  };
}

/**
 * @param cameraId The camera to list, from the Pond's settings; null while those are unknown.
 */
export function useVisionEvents(cameraId: string | null): UseVisionEvents {
  const { hydrated } = useServer();
  const active = useScreenActive();

  const [events, setEvents] = useState<CameraEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [acknowledging, setAcknowledging] = useState<ReadonlySet<number>>(() => new Set());
  const [filter, setFilter] = useState<EventFilter>('all');
  const [live, setLive] = useState(false);
  const [streamBlocked, setStreamBlocked] = useState(false);

  // Another camera's list is not this one's: start over, as useMemories does for its source.
  const [shownFor, setShownFor] = useState(cameraId);
  if (shownFor !== cameraId) {
    setShownFor(cameraId);
    setEvents([]);
    setLoading(true);
    setError(null);
    setFailed(false);
  }

  // The camera reads are for. Kept in step by the effect below, not during render.
  const camera = useRef(cameraId);
  const loadedFor = useRef<string | null>(null);
  // A read that started before an acknowledgement, or an arrival, must not undo it when it lands.
  const changes = useRef(0);

  const load = useCallback(async (loud: boolean) => {
    const id = camera.current;
    if (id === null) return;
    if (loud) {
      setLoading(true);
      setError(null);
    }
    const startedAt = changes.current;
    try {
      const list = await api.listCameraEvents(id, VISION_EVENTS_LIMIT);
      if (camera.current !== id) return;
      if (startedAt === changes.current) setEvents(list);
      loadedFor.current = id;
      setError(null);
      setFailed(false);
    } catch (e) {
      if (camera.current !== id) return;
      const first = loadedFor.current !== id;
      if (loud || first) setError(describeApiError(e));
      else console.warn('[vision-events] refresh failed; showing the last result', e instanceof ApiError ? e.status : 'network');
      if (first) setFailed(true);
    } finally {
      if (camera.current === id) setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load(true), [load]);

  // Declared before the poll, so its first read is already for this camera. A rename reads at
  // once: the poll keeps its own cadence, and the new camera's list is wanted now.
  useEffect(() => {
    const before = camera.current;
    camera.current = cameraId;
    if (hydrated && before !== null && cameraId !== null && before !== cameraId) void load(true);
  }, [cameraId, hydrated, load]);

  useLive(() => load(false), VISION_EVENTS_MS, hydrated && cameraId !== null && !live);

  // The stream, while the screen is in front. Arrivals for another camera are not this list's.
  useEffect(() => {
    if (!hydrated || cameraId === null || !active) return;
    const stop = openVisionStream({
      onEvent: (event) => {
        if (event.camera_id && event.camera_id !== cameraId) return;
        changes.current += 1;
        setEvents((current) => mergeEvent(current, event));
      },
      onLive: (up) => {
        setLive(up);
        // Whatever came in while it was not open is in the list, not in the stream.
        if (up) void load(false);
      },
      onBlocked: setStreamBlocked,
    });
    return () => {
      stop();
      setLive(false);
    };
  }, [hydrated, cameraId, active, load]);

  const acknowledge = useCallback(
    async (event: CameraEvent) => {
      setAcknowledging((current) => new Set(current).add(event.id));
      let done = false;
      try {
        await api.acknowledgeCameraEvent(event.id);
        changes.current += 1;
        setEvents((current) => current.map((e) => (e.id === event.id ? { ...e, acknowledged: true } : e)));
        done = true;
      } catch (e) {
        console.warn('[vision-events] acknowledge failed', event.id, e instanceof ApiError ? e.status : 'network');
        setError(describeApiError(e) ?? i18n.t('visionEvents.errors.acknowledgeFailed'));
      } finally {
        setAcknowledging((current) => {
          const next = new Set(current);
          next.delete(event.id);
          return next;
        });
      }
      // Read back what the Pond now holds, including anything the camera saw meanwhile. Not after
      // a refusal: a successful read clears the error, and the refusal would vanish unread.
      if (done) await load(false);
    },
    [load],
  );

  return {
    data: {
      events,
      shown: filter === 'all' ? events : events.filter((e) => matchesFilter(e, filter)),
      unacknowledged: unacknowledgedCount(events),
      filter,
    },
    live,
    streamBlocked,
    loading,
    error,
    failed,
    acknowledging,
    actions: { refresh, acknowledge, setFilter },
  };
}
