/**
 * Camera events -- what the Pond's camera saw, and which of it somebody has looked at.
 *
 * The Pond lists one camera per read (`GET /api/v1/camera/events?camera_id=`) and has no read
 * across cameras, so the screen asks for the camera the Pond's settings name
 * (`vision_camera_id`): the one its vision pipeline stamps on everything it records. Until the
 * settings arrive that name is unknown, and nothing is read.
 *
 * A poll, because the Pond has no stream a phone can follow for these. Acknowledging is one
 * `PATCH` per event: the Pond offers no "acknowledge all" and no delete, so neither does this.
 * Real Pond only, like Devices: there is no Developer toggle and no sample data behind it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { CameraEvent } from '@/services/types';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';

/** A camera can see something any minute, but a phone glancing at the list needs no faster. */
export const CAMERA_EVENTS_MS = 30_000;

/** How many to ask for. The Pond caps a read at 100 and defaults to 20. */
export const CAMERA_EVENTS_LIMIT = 50;

export interface UseCameraEvents {
  data: {
    events: CameraEvent[];
    /** How many of `events` nobody has acknowledged yet. */
    unacknowledged: number;
  };
  loading: boolean;
  error: string | null;
  /** A load failed and nothing has loaded yet: unknown, not empty. See useSchedules. */
  failed: boolean;
  /** Ids with an acknowledgement on its way to the Pond. */
  acknowledging: ReadonlySet<number>;
  actions: {
    refresh: () => Promise<void>;
    acknowledge: (event: CameraEvent) => Promise<void>;
  };
}

/** The count a list header shows. */
export function unacknowledgedCount(events: readonly CameraEvent[]): number {
  return events.filter((e) => !e.acknowledged).length;
}

/**
 * @param cameraId The camera to list, from the Pond's settings; null while those are unknown.
 */
export function useCameraEvents(cameraId: string | null): UseCameraEvents {
  const { hydrated } = useServer();

  const [events, setEvents] = useState<CameraEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [acknowledging, setAcknowledging] = useState<ReadonlySet<number>>(() => new Set());

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
  // A read that started before an acknowledgement must not undo it when it lands.
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
      const list = await api.listCameraEvents(id, CAMERA_EVENTS_LIMIT);
      if (camera.current !== id) return;
      if (startedAt === changes.current) setEvents(list);
      loadedFor.current = id;
      setError(null);
      setFailed(false);
    } catch (e) {
      if (camera.current !== id) return;
      const first = loadedFor.current !== id;
      if (loud || first) setError(describeApiError(e));
      else console.warn('[camera-events] refresh failed; showing the last result', e instanceof ApiError ? e.status : 'network');
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

  useLive(() => load(false), CAMERA_EVENTS_MS, hydrated && cameraId !== null);

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
        console.warn('[camera-events] acknowledge failed', event.id, e instanceof ApiError ? e.status : 'network');
        setError(describeApiError(e) ?? i18n.t('cameraEvents.errors.acknowledgeFailed'));
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
    data: { events, unacknowledged: unacknowledgedCount(events) },
    loading,
    error,
    failed,
    acknowledging,
    actions: { refresh, acknowledge },
  };
}
