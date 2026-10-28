// One long task, followed from the chat card that started it: read every 5 s while it plans or runs,
// every 30 s while it waits, and never again once it has ended, since an ended task cannot change.

import { useCallback, useRef, useState } from 'react';

import { createMockLongTasks, mockStartResult, type LongTasksSource, type MockLongTasks } from '@/models/long-tasks-mock';
import { isEnded, LONG_TASK_WAITING_MS, pollDelay } from '@/models/long-tasks';
import type { ToolCall } from '@/models/chat';
import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { endedTask, keepEndedTask, keepResultBody, resultBody } from '@/services/long-task-cache';
import type { LongTask, LongTaskArtifactBody, LongTaskKind } from '@/services/types';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';

/** Calls `api` at call time, so a test's mock of the client is the one used. */
export const POND_LONG_TASKS: LongTasksSource = {
  researchAvailability: () => api.deepResearchAvailability(),
  task: (id) => api.longTask(id),
  artifact: (taskId, artifactId) => api.longTaskArtifact(taskId, artifactId),
  cancel: (id) => api.cancelLongTask(id),
};

// One mock for the app, so the task the mock chat starts is the one its card reads.
let mock: MockLongTasks | null = null;

export function mockLongTasks(): MockLongTasks {
  mock ??= createMockLongTasks();
  return mock;
}

/** The chat's own toggle decides: a long task is something the chat started. */
export function useLongTasksSource(): LongTasksSource {
  const { isScreenReal } = useServer();
  return isScreenReal('chat') ? POND_LONG_TASKS : mockLongTasks();
}

/** The mock chat's `task_start` call, with a task to follow; research takes the Pond's `deep-research-` id. */
export function mockTaskStart(goal: string, kind: LongTaskKind = 'general'): ToolCall {
  const id = mockLongTasks().start(goal, kind);
  const call = kind === 'research' ? `deep-research-${id}` : `mock-call-${id}`;
  return { id: call, name: 'giap-tasks__task_start', args: JSON.stringify({ goal }), status: 'ok', result: mockStartResult(id) };
}

/** For tests: the next `mockLongTasks()` starts empty. */
export function resetMockLongTasks(): void {
  mock = null;
}

export interface ResultView {
  open: boolean;
  loading: boolean;
  body: LongTaskArtifactBody | null;
  error: string | null;
}

export interface UseLongTask {
  task: LongTask | null;
  /** The first read failed and nothing is known; with a retry. */
  error: string | null;
  /** The Pond has no such task, or this member does not reach it. */
  gone: boolean;
  stopping: boolean;
  stopError: string | null;
  /** Said once a Stop finds the task already over. */
  notice: string | null;
  result: ResultView;
  actions: {
    retry: () => Promise<void>;
    /** Resolves to whether the Pond stopped it. */
    stop: () => Promise<boolean>;
    openResult: () => Promise<void>;
    closeResult: () => void;
  };
}

const CLOSED: ResultView = { open: false, loading: false, body: null, error: null };

function statusOf(e: unknown): number | 'network' | 'shape' {
  if (e instanceof ApiError) return e.status;
  return e instanceof TypeError ? 'network' : 'shape';
}

export function useLongTask(taskId: string): UseLongTask {
  const { hydrated } = useServer();
  const source = useLongTasksSource();
  const [task, setTask] = useState<LongTask | null>(() => endedTask(taskId));
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ResultView>(CLOSED);
  const latest = useRef<LongTask | null>(task);

  const read = useCallback(async () => {
    try {
      const next = await source.task(taskId);
      latest.current = next;
      setTask(next);
      setError(null);
      if (isEnded(next.state)) keepEndedTask(next);
    } catch (e) {
      console.warn('[long-task] read failed', { status: statusOf(e) });
      if (e instanceof ApiError && e.status === 404) setGone(true);
      else if (!latest.current) setError(describeApiError(e) ?? i18n.t('chat.longTask.loadFailed'));
    }
  }, [source, taskId]);

  const live = hydrated && !gone && !(task && isEnded(task.state));
  // Nothing read yet means the Pond did not answer, which is no reason to ask it faster.
  useLive(read, () => (latest.current ? pollDelay(latest.current.state) : null) ?? LONG_TASK_WAITING_MS, live);

  const stop = useCallback(async () => {
    if (stopping) return false;
    setStopping(true);
    setStopError(null);
    setNotice(null);
    try {
      await source.cancel(taskId);
      await read();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setNotice(i18n.t('chat.longTask.alreadyEnded'));
        await read();
      } else {
        setStopError(describeApiError(e) ?? i18n.t('chat.longTask.stopFailed'));
      }
      return false;
    } finally {
      setStopping(false);
    }
  }, [read, source, stopping, taskId]);

  const openResult = useCallback(async () => {
    const artifactId = latest.current?.result_artifact_id;
    if (!artifactId) return;
    const known = resultBody(artifactId);
    setResult({ open: true, loading: known === null, body: known, error: null });
    if (known) return;
    try {
      const body = await source.artifact(taskId, artifactId);
      keepResultBody(body);
      setResult((r) => (r.open ? { open: true, loading: false, body, error: null } : r));
    } catch (e) {
      console.warn('[long-task] result read failed', { status: statusOf(e) });
      setResult((r) => (r.open ? { open: true, loading: false, body: null, error: i18n.t('chat.longTask.resultFailed') } : r));
    }
  }, [source, taskId]);

  const closeResult = useCallback(() => setResult(CLOSED), []);

  return { task, error, gone, stopping, stopError, notice, result, actions: { retry: read, stop, openResult, closeResult } };
}
