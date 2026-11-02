/**
 * The Pond listening in the room through its own microphone: whether it can, whether it is, who it
 * last heard, and stopping what it is saying.
 *
 * The status is read every 15 seconds while a screen that shows it is in front. A screen that shows
 * the room live (the Voice agent page) also opens `GET /voice/room/events` while it is in front, and
 * folds each event into what it draws; Home does not, because a stream held open for as long as Home
 * is on screen keeps the phone's radio awake for a glance.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { RoomVoiceEvent, VoiceRoom } from '@/services/types';
import { QUIET_ROOM, foldRoomEvent, type RoomLive } from '@/models/voice-room';
import { isMissingRoute } from './agents-source';
import { describeApiError, logFailure } from './describe-error';
import { useLive } from './use-live';
import { useScreenActive } from './use-screen-active';
import { useVoiceSource, type VoiceSource } from './voice-source';

export const VOICE_ROOM_MS = 15_000;

/** A stream that dropped after it was open comes back this soon, and one that never opened backs off from it. */
export const ROOM_STREAM_RETRY_MS = 2_000;
export const ROOM_STREAM_RETRY_MAX_MS = 60_000;

export interface UseVoiceRoom {
  room: VoiceRoom | null;
  live: RoomLive;
  /** Events are arriving as they happen. */
  streaming: boolean;
  /** The Pond has no room voice routes: it needs an update, which is not the same as having failed. */
  missing: boolean;
  loading: boolean;
  /** The first read failed: whether the room listens is unknown, not no. */
  failed: boolean;
  error: string | null;
  switching: boolean;
  interrupting: boolean;
  actions: {
    refresh: () => Promise<void>;
    /** Resolves to why the Pond refused, or null once it has switched. */
    setEnabled: (enabled: boolean) => Promise<string | null>;
    interrupt: () => Promise<void>;
  };
}

/**
 * Keep the room's event stream open until the returned function is called, opening it again whenever
 * it ends. A Pond without the route is not asked again.
 */
export function openRoomStream(
  source: VoiceSource,
  handlers: { onEvent: (event: RoomVoiceEvent) => void; onLive: (live: boolean) => void },
  retryMs = ROOM_STREAM_RETRY_MS,
): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  let backoff = retryMs;
  let reopen: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    reopen = null;
    let opened = false;
    void (async () => {
      let missing = false;
      try {
        await source.streamRoom(handlers.onEvent, signal, () => {
          opened = true;
          backoff = retryMs;
          handlers.onLive(true);
        });
      } catch (e) {
        missing = isMissingRoute(e);
      }
      if (signal.aborted) return;
      handlers.onLive(false);
      if (missing) return;
      const wait = opened ? retryMs : backoff;
      backoff = Math.min(backoff * 2, ROOM_STREAM_RETRY_MAX_MS);
      reopen = setTimeout(open, wait);
    })();
  };
  open();

  return () => {
    controller.abort();
    if (reopen) clearTimeout(reopen);
  };
}

export function useVoiceRoom({ stream = false }: { stream?: boolean } = {}): UseVoiceRoom {
  const { hydrated } = useServer();
  const source = useVoiceSource();
  const active = useScreenActive();
  const [room, setRoom] = useState<VoiceRoom | null>(null);
  const [live, setLive] = useState<RoomLive>(QUIET_ROOM);
  const [streaming, setStreaming] = useState(false);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const loaded = useRef(false);

  const take = useCallback((next: VoiceRoom) => {
    setRoom(next);
    setLive((was) => ({ ...was, state: next.state }));
  }, []);

  const load = useCallback(
    async (loud: boolean) => {
      if (loud) {
        setLoading(true);
        setError(null);
      }
      try {
        take(await source.room());
        loaded.current = true;
        setMissing(false);
        setFailed(false);
        setError(null);
      } catch (e) {
        if (isMissingRoute(e)) {
          setMissing(true);
          setFailed(false);
          setError(null);
        } else {
          logFailure('voice-room', 'status read failed', e);
          if (loud || !loaded.current) setError(describeApiError(e) ?? i18n.t('voiceRoom.loadFailed'));
          if (!loaded.current) setFailed(true);
        }
      } finally {
        setLoading(false);
      }
    },
    [source, take],
  );

  const refresh = useCallback(() => load(true), [load]);

  useLive(() => load(false), VOICE_ROOM_MS, hydrated && !missing);

  useEffect(() => {
    if (!stream || !hydrated || !active || missing) return;
    const stop = openRoomStream(source, {
      onEvent: (event) => {
        setLive((was) => foldRoomEvent(was, event));
        if (event.event === 'wake' && event.who) {
          const who = event.who;
          setRoom((was) => (was ? { ...was, last_heard: { ...who, at: new Date().toISOString() } } : was));
        }
      },
      onLive: (up) => {
        setStreaming(up);
        // What happened while it was closed is in the status, not in the stream.
        if (up) void load(false);
      },
    });
    return () => {
      stop();
      setStreaming(false);
    };
  }, [stream, hydrated, active, missing, source, load]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      setSwitching(true);
      try {
        take(await source.setRoom(enabled));
        return null;
      } catch (e) {
        logFailure('voice-room', 'switch refused', e);
        if (isMissingRoute(e)) setMissing(true);
        return describeApiError(e) ?? i18n.t('voiceRoom.switchFailed');
      } finally {
        setSwitching(false);
      }
    },
    [source, take],
  );

  const interrupt = useCallback(async () => {
    setInterrupting(true);
    try {
      await source.interrupt();
      setLive((was) => ({ ...was, interrupted: 'button' }));
    } catch (e) {
      // Nothing was speaking by the time it arrived, which is what was wanted.
      if (!(e instanceof ApiError && e.status === 409)) {
        logFailure('voice-room', 'interrupt refused', e);
        setError(describeApiError(e) ?? i18n.t('voiceRoom.interruptFailed'));
      }
    } finally {
      setInterrupting(false);
      void load(false);
    }
  }, [load, source]);

  return {
    room,
    live,
    streaming,
    missing,
    loading,
    failed,
    error,
    switching,
    interrupting,
    actions: { refresh, setEnabled, interrupt },
  };
}
