// An in-memory Pond for long tasks, for the chat on mock: a task plans, runs three steps and finishes
// with a result, on the clock read at each call, and Stop ends it as the real cancel route does.

import { ApiError } from '@/services/api-client';
import type { DeepResearchAvailability, LongTask, LongTaskArtifactBody, LongTaskKind, LongTaskStep, LongTaskStepState } from '@/services/types';

/** The routes the chat's long-task card and research use, so the real Pond and this one run the same code. */
export interface LongTasksSource {
  researchAvailability(): Promise<DeepResearchAvailability>;
  task(id: string): Promise<LongTask>;
  artifact(taskId: string, artifactId: string): Promise<LongTaskArtifactBody>;
  cancel(id: string): Promise<void>;
}

export const MOCK_PLANNING_MS = 4_000;
export const MOCK_STEP_MS = 6_000;

/** `task_start`'s own answer, as the Pond words it (pond-mcp-server `long_task.rs`). */
export function mockStartResult(id: string): string {
  return `Started task ${id}. The pond works on it while the household is quiet and tells the person on their phone when it is done.`;
}

/** What the mock chat says when asked for research, after the task it started. */
export const MOCK_RESEARCH_REPLY = "I've started researching that. I'll let you know on this phone when the findings are ready.";

/** What the mock chat says when asked for a long task, beside the `task_start` call it shows. */
export const MOCK_TASK_REPLY = "I've started that as a long task. I'll let you know on this phone when it's done.";

const PLAN: { key: string; role: string; summary: string }[] = [
  { key: 'gather', role: 'long-task-worker', summary: 'Found three places to stay and the train times.' },
  { key: 'compare', role: 'trip-planner', summary: 'Compared prices for the two weekends.' },
  { key: 'check', role: 'long-task-verifier', summary: 'Checked the plan against the dates you gave.' },
];

const RESULT_BODY = `## A weekend in Mombasa

- **Getting there:** the Madaraka Express leaves Nairobi at 08:00 and arrives at 14:00.
- **Staying:** two nights by Nyali beach, about KES 18,000 in all.
- **Seeing:** Fort Jesus on Saturday morning, the old town in the afternoon.
`;

interface Entry {
  goal: string;
  kind: LongTaskKind;
  startedAt: number;
  cancelledAt: number | null;
}

export function createMockLongTasks(now: () => number = Date.now) {
  const tasks = new Map<string, Entry>();
  let next = 1;
  const iso = (ms: number) => new Date(ms).toISOString();

  const view = (id: string): LongTask => {
    const entry = tasks.get(id);
    if (!entry) throw new ApiError(`mock /api/v1/long-tasks/${id} → 404`, 404, null, 'there is no such task');
    const t = entry.cancelledAt ?? now();
    const elapsed = t - entry.startedAt;
    const planned = elapsed >= MOCK_PLANNING_MS;
    const index = planned ? Math.floor((elapsed - MOCK_PLANNING_MS) / MOCK_STEP_MS) : -1;
    const finished = planned && index >= PLAN.length;
    const stepState = (i: number): LongTaskStepState => {
      if (i < index) return 'completed';
      if (entry.cancelledAt) return 'skipped';
      return i === index ? 'running' : 'pending';
    };
    const steps: LongTaskStep[] = planned
      ? PLAN.map((p, i) => ({
          key: p.key,
          role: p.role,
          state: stepState(i),
          attempts: i <= index ? 1 : 0,
          summary: i < index ? p.summary : null,
          failure: null,
        }))
      : [];
    const endedAt = entry.cancelledAt ?? (finished ? entry.startedAt + MOCK_PLANNING_MS + PLAN.length * MOCK_STEP_MS : null);
    return {
      id,
      kind: entry.kind,
      goal: entry.goal,
      state: entry.cancelledAt ? 'cancelled' : finished ? 'completed' : planned ? 'running' : 'planning',
      origin_session_id: 'mock-session',
      created_at: iso(entry.startedAt),
      updated_at: iso(t),
      finished_at: endedAt === null ? null : iso(endedAt),
      steps,
      artifacts: finished
        ? [{ id: `${id}-result`, task_id: id, step_key: 'check', kind: 'draft', title: 'Weekend plan', summary: 'Two nights by the beach, by train, for about KES 18,000.', tokens: 120, created_at: iso(endedAt ?? t) }]
        : [],
      result_artifact_id: finished ? `${id}-result` : null,
    };
  };

  return {
    /** What the mock chat calls when asked for a long task; the id goes in its `task_start` answer. */
    start(goal: string, kind: LongTaskKind = 'general'): string {
      const id = `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
      tasks.set(id, { goal, kind, startedAt: now(), cancelledAt: null });
      return id;
    },
    researchAvailability: async (): Promise<DeepResearchAvailability> => ({ available: true }),
    task: async (id: string) => view(id),
    artifact: async (taskId: string, artifactId: string) => {
      const task = view(taskId);
      if (task.result_artifact_id !== artifactId) throw new ApiError('mock artifact → 404', 404, null, 'there is no such artifact in this task');
      return { id: artifactId, title: 'Weekend plan', kind: 'draft', summary: task.artifacts[0].summary, body: RESULT_BODY };
    },
    cancel: async (id: string) => {
      const task = view(id);
      if (task.state === 'completed' || task.state === 'failed' || task.state === 'cancelled') {
        throw new ApiError('mock cancel → 409', 409, null, `the task has already ${task.state}`);
      }
      tasks.get(id)!.cancelledAt = now();
    },
  };
}

export type MockLongTasks = ReturnType<typeof createMockLongTasks>;
