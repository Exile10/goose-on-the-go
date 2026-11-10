/**
 * Debug — developer mode on a Jarida test Pond (issue #165): the debug switch, which model chat
 * runs on with a way back to the last one that answered, how long each command took, and the
 * Pond's log as it is written.
 *
 * A home Pond has none of it. `testPond` is null until the Pond has said, and false on a home
 * Pond, where the screen shows nothing to switch and opens no stream.
 *
 * The log stream is held only while the screen is open: the Pond allows four at once, and an
 * abandoned one keeps delivering to a screen that is gone. So each time it opens, the lines the
 * Pond already holds are read first: a command run from the chat while this screen was closed
 * still shows, with its timing. When it drops it is reopened after a pause, a longer one when
 * the Pond said it had no stream to spare.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { ActiveChatRole, LogEntry } from '@/services/types';
import {
  LOG_LINES_KEPT,
  TIMINGS_KEPT,
  commandTiming,
  groupLog,
  mergeNewestFirst,
  traceKind,
  type CommandTiming,
  type LogItem,
} from '@/models/debug';
import { describeApiError } from './describe-error';

export const STREAM_RETRY_MS = 5_000;
/** After a 503: the other viewers are not about to leave. */
export const STREAM_BUSY_RETRY_MS = 30_000;

export type StreamState = 'connecting' | 'live' | 'busy' | 'offline';

export interface UseDebug {
  data: {
    /** null until the Pond has answered. */
    testPond: boolean | null;
    debug: boolean;
    chat: ActiveChatRole | null;
    lines: LogEntry[];
    /** The same lines as the screen lists them: a chat message's together, repeats counted. */
    items: LogItem[];
    timings: CommandTiming[];
    /** Device id to the name the household gave it, for the timing table. */
    deviceNames: ReadonlyMap<string, string>;
    /** Lines the Pond dropped because this phone fell behind, since the screen opened. */
    skipped: number;
    stream: StreamState;
  };
  loading: boolean;
  busy: { debug: boolean; rollback: boolean };
  error: string | null;
  actions: {
    setDebug: (enabled: boolean) => Promise<void>;
    rollback: () => Promise<boolean>;
    refresh: () => Promise<void>;
  };
}

/** The words for a refusal this screen expects; anything else is the shared reading. */
export function describeDebugError(e: unknown): string | null {
  if (e instanceof ApiError) {
    if (e.detail === 'not_a_test_pond') return i18n.t('debug.error.notTestPond');
    if (e.detail === 'not_a_developer') return i18n.t('debug.error.notDeveloper');
    if (e.detail === 'nothing_to_roll_back') return i18n.t('debug.error.nothingToRollBack');
    if (e.status === 404) return i18n.t('debug.error.unsupported');
  }
  return describeApiError(e);
}

export function useDebug(): UseDebug {
  const [testPond, setTestPond] = useState<boolean | null>(null);
  const [debug, setDebugState] = useState(false);
  const [chat, setChat] = useState<ActiveChatRole | null>(null);
  const [lines, setLines] = useState<LogEntry[]>([]);
  const items = useMemo(() => groupLog(lines), [lines]);
  const [timings, setTimings] = useState<CommandTiming[]>([]);
  const [deviceNames, setDeviceNames] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [skipped, setSkipped] = useState(0);
  const [stream, setStream] = useState<StreamState>('connecting');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({ debug: false, rollback: false });
  const [error, setError] = useState<string | null>(null);

  const readChat = useCallback(async () => {
    try {
      setChat(await api.activeChatRole());
    } catch (e) {
      console.warn('[debug] could not read the chat model', e instanceof ApiError ? e.status : 'network');
    }
  }, []);

  // Timing names a device as the household does; without the list it still shows its id.
  const readDeviceNames = useCallback(async () => {
    try {
      const devices = await api.listDevices();
      setDeviceNames(new Map(devices.map((d) => [d.id, d.name])));
    } catch (e) {
      console.warn('[debug] could not read the device names', e instanceof ApiError ? e.status : 'network');
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const state = await api.developerDebug();
      setTestPond(state.test_pond);
      setDebugState(state.debug);
      setError(null);
      if (state.test_pond) await Promise.all([readChat(), readDeviceNames()]);
    } catch (e) {
      // A Pond from before developer mode has no such route: it is no test Pond.
      if (e instanceof ApiError && e.status === 404) setTestPond(false);
      else setError(describeDebugError(e));
    } finally {
      setLoading(false);
    }
  }, [readChat, readDeviceNames]);

  useEffect(() => {
    // After this render, not inside it: the first read sets state.
    void Promise.resolve().then(load);
  }, [load]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await load();
  }, [load]);

  useEffect(() => {
    if (testPond !== true) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | null = null;

    // Once the stream is open, so nothing written in between is missed; the ids sort out overlap.
    const readRecent = async () => {
      try {
        const recent = await api.listLogs({ limit: LOG_LINES_KEPT });
        if (controller.signal.aborted) return;
        setLines((live) => mergeNewestFirst(live, recent, LOG_LINES_KEPT));
        const recentTimings = recent.map(commandTiming).filter((t): t is CommandTiming => t !== null);
        setTimings((live) => mergeNewestFirst(live, recentTimings, TIMINGS_KEPT));
      } catch (e) {
        console.warn('[debug] could not read the recent log', e instanceof ApiError ? e.status : 'network');
      }
    };

    const open = async () => {
      if (controller.signal.aborted) return;
      setStream('connecting');
      let wait = STREAM_RETRY_MS;
      try {
        await api.streamLogs(
          (event) => {
            if (event.kind === 'skipped') {
              setSkipped((n) => n + event.count);
              return;
            }
            if (event.kind === 'status') return;
            const entry = event.entry;
            // The recent read may already hold it, when it landed while that read was out.
            setLines((list) => mergeNewestFirst([entry], list, LOG_LINES_KEPT));
            const timing = commandTiming(entry);
            if (timing) setTimings((list) => mergeNewestFirst([timing], list, TIMINGS_KEPT));
            // A switch made anywhere, from this screen or another phone.
            if (traceKind(entry) === 'model_activated') void readChat();
          },
          controller.signal,
          () => {
            setStream('live');
            void readRecent();
          },
        );
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 503) {
          setStream('busy');
          wait = STREAM_BUSY_RETRY_MS;
        } else {
          console.warn('[debug] log stream dropped', e instanceof ApiError ? e.status : 'network');
        }
      }
      if (controller.signal.aborted) return;
      setStream((s) => (s === 'busy' ? s : 'offline'));
      retry = setTimeout(() => void open(), wait);
    };

    void open();
    return () => {
      controller.abort();
      if (retry) clearTimeout(retry);
    };
  }, [testPond, readChat]);

  const setDebug = useCallback(async (enabled: boolean) => {
    setBusy((b) => ({ ...b, debug: true }));
    setDebugState(enabled);
    try {
      const state = await api.setDeveloperDebug(enabled);
      setDebugState(state.debug);
      setError(null);
    } catch (e) {
      setDebugState(!enabled);
      setError(describeDebugError(e));
    } finally {
      setBusy((b) => ({ ...b, debug: false }));
    }
  }, []);

  const rollback = useCallback(async () => {
    setBusy((b) => ({ ...b, rollback: true }));
    try {
      await api.rollbackModel();
      setError(null);
      await readChat();
      return true;
    } catch (e) {
      setError(describeDebugError(e));
      return false;
    } finally {
      setBusy((b) => ({ ...b, rollback: false }));
    }
  }, [readChat]);

  return {
    data: { testPond, debug, chat, lines, items, timings, deviceNames, skipped, stream },
    loading,
    busy,
    error,
    actions: { setDebug, rollback, refresh },
  };
}
