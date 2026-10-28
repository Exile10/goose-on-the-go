// An in-memory Pond for long tasks, for the chat on mock: a task plans, runs three steps and finishes
// with a result, on the clock read at each call, and Stop ends it as the real cancel route does. One
// slot works them in the order they were asked for, so a second task waits its turn, as on the Pond.

import { ApiError } from '@/services/api-client';
import { REPORT_FILES } from '@/models/long-tasks';
import type {
  DeepResearchAvailability,
  LongTask,
  LongTaskArtifactBody,
  LongTaskKind,
  LongTaskQueuePlace,
  LongTaskReportWire,
  LongTaskState,
  LongTaskStep,
  LongTaskStepState,
  ReportFormat,
} from '@/services/types';

/** The routes the chat's long-task card and research use, so the real Pond and this one run the same code. */
export interface LongTasksSource {
  researchAvailability(): Promise<DeepResearchAvailability>;
  task(id: string): Promise<LongTask>;
  report(id: string): Promise<LongTaskReportWire>;
  export(id: string, format: ReportFormat): Promise<{ name: string; body: string }>;
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

/** What the mock's composer would draft for a plan: days, times, a table, a checklist and map links. */
const REPORT_SECTIONS = `## Day 1: Saturday

- 08:00 Madaraka Express from Nairobi Terminus
- 14:00 Arrive in Mombasa, check in by Nyali beach
- 17:00 Walk to [Fort Jesus](https://www.openstreetmap.org/search?query=Fort%20Jesus%20Mombasa)

## Day 2: Sunday

- 09:00 Old Town walk, starting at the [Old Port](https://www.openstreetmap.org/search?query=Old%20Port%20Mombasa)
- 15:30 Train back to Nairobi

## Meals

| Day | Breakfast | Lunch | Dinner |
| --- | --- | --- | --- |
| Saturday | On the train | Biryani in Old Town | Grilled fish at the beach |
| Sunday | Mandazi and chai | Packed lunch | At home |

## Packing

- [x] Train tickets
- [ ] Sunscreen
- [ ] ~~Rain jacket~~ Light cardigan

## Sources

- [Madaraka Express timetable](https://metickets.krc.co.ke)
`;

interface Entry {
  goal: string;
  kind: LongTaskKind;
  askedAt: number;
  cancelledAt: number | null;
  /** Holds a place in the line; this member can neither read nor stop it, as on the Pond. */
  anotherMember: boolean;
}

const RUN_MS = MOCK_PLANNING_MS + PLAN.length * MOCK_STEP_MS;

export function createMockLongTasks(now: () => number = Date.now) {
  const tasks = new Map<string, Entry>();
  let next = 1;
  const iso = (ms: number) => new Date(ms).toISOString();

  /** When the one slot reaches each task: once every task asked before it has finished or been stopped. */
  const turns = (): Map<string, number> => {
    const out = new Map<string, number>();
    let free = -Infinity;
    for (const [id, entry] of tasks) {
      const turn = Math.max(entry.askedAt, free);
      out.set(id, turn);
      free = Math.max(free, Math.min(entry.cancelledAt ?? Infinity, turn + RUN_MS));
    }
    return out;
  };

  const progress = (entry: Entry, turn: number) => {
    const t = entry.cancelledAt ?? now();
    const elapsed = t - turn;
    const planned = elapsed >= MOCK_PLANNING_MS;
    const index = planned ? Math.floor((elapsed - MOCK_PLANNING_MS) / MOCK_STEP_MS) : -1;
    const finished = planned && index >= PLAN.length;
    // A task waiting its turn is planning on the Pond too: it has not been given a plan yet.
    const state: LongTaskState = entry.cancelledAt ? 'cancelled' : finished ? 'completed' : planned ? 'running' : 'planning';
    return { t, planned, index, finished, state };
  };

  const placeOf = (id: string, when: Map<string, number>): LongTaskQueuePlace | null => {
    const line = [...tasks].filter(([other, entry]) => {
      const state = progress(entry, when.get(other)!).state;
      return state === 'planning' || state === 'running';
    });
    const index = line.findIndex(([other]) => other === id);
    if (index < 0) return null;
    return {
      position: index + 1,
      of: line.length,
      ahead: line.slice(0, index).map(([other, entry]) =>
        entry.anotherMember ? { another_member: true as const } : { id: other, goal: entry.goal, state: progress(entry, when.get(other)!).state },
      ),
    };
  };

  /** The task as this member reaches it; another member's is a 404, as the Pond answers it. */
  const reachable = (id: string): Entry => {
    const entry = tasks.get(id);
    if (!entry || entry.anotherMember) throw new ApiError(`mock /api/v1/long-tasks/${id} → 404`, 404, null, 'there is no such task');
    return entry;
  };

  const view = (id: string): LongTask => {
    const entry = reachable(id);
    const when = turns();
    const turn = when.get(id)!;
    const { t, planned, index, finished, state } = progress(entry, turn);
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
    const endedAt = entry.cancelledAt ?? (finished ? turn + RUN_MS : null);
    return {
      id,
      kind: entry.kind,
      goal: entry.goal,
      state,
      origin_session_id: 'mock-session',
      created_at: iso(entry.askedAt),
      updated_at: iso(t),
      finished_at: endedAt === null ? null : iso(endedAt),
      steps,
      artifacts: finished
        ? [{ id: `${id}-result`, task_id: id, step_key: 'check', kind: 'draft', title: 'Weekend plan', summary: 'Two nights by the beach, by train, for about KES 18,000.', tokens: 120, created_at: iso(endedAt ?? t) }]
        : [],
      result_artifact_id: finished ? `${id}-result` : null,
      queue: placeOf(id, when),
    };
  };

  const created = {
    /**
     * What the mock chat calls when asked for a long task; the id goes in its `task_start` answer.
     * `anotherMember` asks it for someone else in the household, for a line this member cannot see into.
     */
    start(goal: string, kind: LongTaskKind = 'general', { anotherMember = false }: { anotherMember?: boolean } = {}): string {
      const id = `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
      tasks.set(id, { goal, kind, askedAt: now(), cancelledAt: null, anotherMember });
      return id;
    },
    researchAvailability: async (): Promise<DeepResearchAvailability> => ({ available: true }),
    task: async (id: string) => view(id),
    report: async (id: string): Promise<LongTaskReportWire> => {
      const task = view(id);
      const title = task.goal.length > 80 ? `${task.goal.slice(0, 77)}...` : task.goal;
      const done = task.state === 'completed';
      return {
        id,
        title,
        state: task.state,
        kind: task.kind,
        markdown: `# ${title}\n\nTwo nights by the beach, by train, for about KES 18,000.\n\n${done ? REPORT_SECTIONS : ''}`,
        sections: done ? 4 : 0,
        sources: done ? [{ title: 'Madaraka Express timetable', url: 'https://metickets.krc.co.ke' }] : [],
        calendar_events: done ? 4 : 0,
      };
    },
    export: async (id: string, format: ReportFormat) => {
      const report = await created.report(id);
      if (format === 'ics' && report.calendar_events === 0) throw new ApiError('mock export → 404', 404, null, 'this report has no dated events for a calendar');
      const body =
        format === 'html'
          ? `<!doctype html><title>${report.title.replace(/[<&>"]/g, '')}</title><pre>${report.markdown.replace(/[<&>]/g, '')}</pre>`
          : format === 'ics'
            ? 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Mock Pond//EN\r\nEND:VCALENDAR\r\n'
            : report.markdown;
      return { name: `weekend-plan.${REPORT_FILES[format].extension}`, body };
    },
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
      reachable(id).cancelledAt = now();
    },
  };
  return created;
}

export type MockLongTasks = ReturnType<typeof createMockLongTasks>;
