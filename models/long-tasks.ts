// A long task the assistant started from the chat with `task_start`, which runs later, outside the
// turn. The chat finds it by the id in that tool's answer and follows it from there.

import { bareToolName } from '@/constants/tools';
import type { ToolCall } from '@/models/chat';
import type {
  DeepResearchAvailability,
  LongTask,
  LongTaskArtifact,
  LongTaskState,
  LongTaskStep,
  LongTaskStepState,
} from '@/services/types';

const TASK_STATES: readonly LongTaskState[] = ['planning', 'running', 'awaiting_approval', 'paused', 'completed', 'failed', 'cancelled'];
const STEP_STATES: readonly LongTaskStepState[] = ['pending', 'running', 'completed', 'failed', 'skipped', 'awaiting_approval'];

/** While it is planning or running: the poll floor, so a step that finishes is seen finishing. */
export const LONG_TASK_ACTIVE_MS = 5_000;
/** Waiting for a decision or paused: it moves when a person or the Pond's quiet hours move it. */
export const LONG_TASK_WAITING_MS = 30_000;

/** The id in `task_start`'s answer: "Started task <id>. The pond works on it...". */
export function taskIdFromResult(result: string | undefined): string | null {
  const found = /\bStarted task ([A-Za-z0-9][A-Za-z0-9_-]{7,127})\b/.exec(result ?? '');
  return found ? found[1] : null;
}

/** The long task a tool call started, or null for any other call, or one that did not start one. */
export function startedTaskId(tool: ToolCall): string | null {
  if (bareToolName(tool.name) !== 'task_start' || tool.status !== 'ok') return null;
  return taskIdFromResult(tool.result);
}

export function isEnded(state: LongTaskState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

/** How long until the task is read again, or null once it has ended and cannot change. */
export function pollDelay(state: LongTaskState): number | null {
  if (isEnded(state)) return null;
  return state === 'planning' || state === 'running' ? LONG_TASK_ACTIVE_MS : LONG_TASK_WAITING_MS;
}

export function resultArtifact(task: LongTask): LongTaskArtifact | null {
  if (!task.result_artifact_id) return null;
  return task.artifacts.find((a) => a.id === task.result_artifact_id) ?? null;
}

export function progressOf(steps: readonly LongTaskStep[]): { done: number; total: number; skipped: number } {
  return {
    done: steps.filter((s) => s.state === 'completed').length,
    total: steps.length,
    skipped: steps.filter((s) => s.state === 'skipped').length,
  };
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const textOrNull = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);

/**
 * A task as the Pond sent it, or null for a body that is not one. A state this phone does not know
 * is not one it can say anything true about, so that is null too.
 */
export function readLongTask(raw: unknown): LongTask | null {
  const t = raw as Record<string, unknown> | null;
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !TASK_STATES.includes(t.state as LongTaskState)) return null;
  const steps: LongTaskStep[] = (Array.isArray(t.steps) ? t.steps : []).flatMap((item) => {
    const s = item as Record<string, unknown> | null;
    if (!s || typeof s.key !== 'string') return [];
    return [
      {
        key: s.key,
        role: text(s.role),
        state: STEP_STATES.includes(s.state as LongTaskStepState) ? (s.state as LongTaskStepState) : 'pending',
        attempts: typeof s.attempts === 'number' ? s.attempts : 0,
        summary: textOrNull(s.summary),
        failure: textOrNull(s.failure),
      },
    ];
  });
  const artifacts: LongTaskArtifact[] = (Array.isArray(t.artifacts) ? t.artifacts : []).flatMap((item) => {
    const a = item as Record<string, unknown> | null;
    if (!a || typeof a.id !== 'string') return [];
    return [
      {
        id: a.id,
        task_id: text(a.task_id),
        step_key: textOrNull(a.step_key),
        kind: text(a.kind),
        title: text(a.title),
        summary: text(a.summary),
        tokens: typeof a.tokens === 'number' ? a.tokens : 0,
        created_at: text(a.created_at),
      },
    ];
  });
  return {
    id: t.id,
    kind: t.kind === 'research' ? 'research' : 'general',
    goal: text(t.goal),
    state: t.state as LongTaskState,
    origin_session_id: textOrNull(t.origin_session_id),
    created_at: text(t.created_at),
    updated_at: text(t.updated_at),
    finished_at: textOrNull(t.finished_at),
    steps,
    artifacts,
    result_artifact_id: textOrNull(t.result_artifact_id),
  };
}

/** Null for a body that is not the answer, which the composer reads as "do not offer it". */
export function readResearchAvailability(raw: unknown): DeepResearchAvailability | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || typeof r.available !== 'boolean') return null;
  if (r.available) return { available: true };
  return r.reason === 'off' || r.reason === 'unidentified' ? { available: false, reason: r.reason } : null;
}

/** What the composer's menu offers: nothing, the item, or the item greyed with why. */
export type ResearchOffer = 'hidden' | 'available' | 'unidentified';

/** `null` is a Pond that predates research, or an answer that could not be read: either way, hidden. */
export function researchOffer(availability: DeepResearchAvailability | null): ResearchOffer {
  if (!availability) return 'hidden';
  if (availability.available) return 'available';
  return availability.reason === 'unidentified' ? 'unidentified' : 'hidden';
}
