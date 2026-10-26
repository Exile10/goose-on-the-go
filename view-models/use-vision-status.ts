/**
 * What the pond's camera is doing, read from `GET /vision/status`, and its latest frame.
 *
 * Two reads at two paces. The status is a sentence and changes rarely, so it follows the app's
 * usual poll. The frame is a picture, and a picture of a room that is read every five seconds
 * looks like a stuck one, so it is read about once a second -- but only while it is on screen and
 * the camera is running: `useLive` holds both off whenever the screen is not in front and the app
 * is not in the foreground, and nothing is read for a camera that is not producing frames.
 *
 * Real Pond only, like Devices: there is no Developer toggle and no sample data behind it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import { describeVision, type VisionSentence } from '@/models/vision';
import type { VisionStatus } from '@/services/types';
import { describeApiError, refusalReason } from './describe-error';
import { LIVE_VIEW_POLL_MS, MIN_POLL_MS, useLive } from './use-live';

/** What the pipeline is doing changes by the minute at most; the floor is as fast as a poll goes. */
export const VISION_STATUS_MS = MIN_POLL_MS;

/** Frames that failed in a row before the picture says it is not arriving. */
export const FRAME_MISSES_BEFORE_STALE = 3;

export interface CameraFrame {
  /** The latest picture as a data URI, or null before the first one and while the camera is not running. */
  uri: string | null;
  /** Several in a row did not arrive: what is drawn, if anything, is old. */
  stale: boolean;
  /** Cameras are off in Privacy, which refuses every picture. */
  blocked: boolean;
}

/**
 * Read a camera's frame about once a second while `enabled`.
 *
 * @param cameraId The camera to read, or null until the status names it.
 */
export function useCameraFrame(cameraId: string | null, enabled: boolean): CameraFrame {
  const { hydrated } = useServer();
  const [uri, setUri] = useState<string | null>(null);
  const [misses, setMisses] = useState(0);
  const [blocked, setBlocked] = useState(false);

  const camera = useRef(cameraId);
  // A frame that was slow must not replace a newer one that already landed.
  const reads = useRef(0);

  // Another camera's picture is not this one's, and nothing old is shown for a camera that is not
  // running: start over rather than hold a minutes-old frame behind a "live" label.
  const [shownFor, setShownFor] = useState({ cameraId, enabled });
  if (shownFor.cameraId !== cameraId || shownFor.enabled !== enabled) {
    setShownFor({ cameraId, enabled });
    if (shownFor.cameraId !== cameraId || !enabled) {
      setUri(null);
      setMisses(0);
      setBlocked(false);
    }
  }

  // A read still out when the camera changes, or the picture goes off, belongs to the old one.
  useEffect(() => {
    camera.current = cameraId;
    reads.current += 1;
  }, [cameraId, enabled]);

  const read = useCallback(async () => {
    const id = cameraId;
    if (id === null) return;
    const mine = ++reads.current;
    try {
      const frame = await api.fetchImage(api.cameraSnapshotPath(id));
      if (mine !== reads.current || camera.current !== id) return;
      setUri(frame);
      setMisses(0);
      setBlocked(false);
    } catch (e) {
      if (mine !== reads.current || camera.current !== id) return;
      if (e instanceof ApiError && e.status === 403 && refusalReason(e) === 'cameras_disabled') {
        setBlocked(true);
        return;
      }
      setMisses((n) => n + 1);
    }
  }, [cameraId]);

  useLive(read, LIVE_VIEW_POLL_MS, hydrated && enabled && cameraId !== null, LIVE_VIEW_POLL_MS);

  return { uri: enabled ? uri : null, stale: misses >= FRAME_MISSES_BEFORE_STALE, blocked };
}

export interface UseVisionStatus {
  data: {
    status: VisionStatus | null;
    /** The status in words, or null before it has been read. */
    sentence: VisionSentence | null;
    frame: CameraFrame;
  };
  loading: boolean;
  error: string | null;
  /** The first read failed: what the camera is doing is unknown, not "nothing". */
  failed: boolean;
  /** This Pond does not report what its camera is doing. */
  unsupported: boolean;
  actions: { refresh: () => Promise<void> };
}

/**
 * The pipeline's status, and while it is running its frame.
 *
 * @param wantFrame Whether the screen draws the frame, so a screen that only needs the sentence
 *   reads no pictures.
 */
export function useVisionStatus(wantFrame = true): UseVisionStatus {
  const { hydrated } = useServer();
  const [status, setStatus] = useState<{ value: VisionStatus; readAt: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const loaded = useRef(false);

  const load = useCallback(async (loud: boolean) => {
    if (loud) {
      setLoading(true);
      setError(null);
    }
    try {
      const value = await api.visionStatus();
      setStatus({ value, readAt: Date.now() });
      loaded.current = true;
      setError(null);
      setFailed(false);
      setUnsupported(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setUnsupported(true);
      } else if (loud || !loaded.current) {
        setError(describeApiError(e));
        if (!loaded.current) setFailed(true);
      } else {
        console.warn('[vision] status refresh failed; showing the last result', e instanceof ApiError ? e.status : 'network');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load(true), [load]);

  useLive(() => load(false), VISION_STATUS_MS, hydrated);

  const running = status?.value.state === 'running';
  const frame = useCameraFrame(wantFrame && running ? status?.value.camera_id ?? null : null, wantFrame && running);

  return {
    data: {
      status: status?.value ?? null,
      sentence: status ? describeVision(status.value, status.readAt) : null,
      frame,
    },
    loading,
    error,
    failed,
    unsupported,
    actions: { refresh },
  };
}
