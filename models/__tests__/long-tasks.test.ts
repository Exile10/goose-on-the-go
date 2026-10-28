// The chat finds a long task by the id in `task_start`'s answer, so that is read from the Pond's exact
// words; and the mock Pond has to move through a task's states as the real one does.

import { createMockLongTasks, MOCK_PLANNING_MS, MOCK_STEP_MS, mockStartResult } from '@/models/long-tasks-mock';
import {
  isWaiting,
  LONG_TASK_ACTIVE_MS,
  LONG_TASK_WAITING_MS,
  pollDelay,
  progressOf,
  queueChoices,
  readLongTask,
  resultArtifact,
  startedTaskId,
  taskIdFromResult,
} from '@/models/long-tasks';
import type { ToolCall } from '@/models/chat';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));

const ID = '3f2b7c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b';
// pond-mcp-server long_task.rs, run_start.
const POND_ANSWER = `Started task ${ID}. The pond works on it while the household is quiet and tells the person on their phone when it is done. Tell the person it has started; task_status with this id says how far it has got.`;

const call = (over: Partial<ToolCall>): ToolCall => ({ id: 'c1', name: 'giap-tasks__task_start', args: '{}', status: 'ok', result: POND_ANSWER, ...over });

describe('finding the task a turn started', () => {
  it("reads the id out of the Pond's own answer", () => {
    expect(taskIdFromResult(POND_ANSWER)).toBe(ID);
    expect(taskIdFromResult(mockStartResult('00000000-0000-4000-8000-000000000001'))).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('finds nothing in a refusal, or in an answer that is not there', () => {
    expect(taskIdFromResult('Could not start the task: the goal is empty.')).toBeNull();
    expect(taskIdFromResult(undefined)).toBeNull();
  });

  it('follows only a task_start that finished, under whatever extension serves it', () => {
    expect(startedTaskId(call({}))).toBe(ID);
    expect(startedTaskId(call({ name: 'task_start' }))).toBe(ID);
    expect(startedTaskId(call({ status: 'running', result: undefined }))).toBeNull();
    expect(startedTaskId(call({ status: 'error' }))).toBeNull();
    expect(startedTaskId(call({ name: 'giap-tasks__task_status' }))).toBeNull();
  });
});

describe('how often a task is read', () => {
  it('reads quickly while it plans or runs, slowly while it waits, and not at all once it has ended', () => {
    expect(pollDelay('planning')).toBe(LONG_TASK_ACTIVE_MS);
    expect(pollDelay('running')).toBe(LONG_TASK_ACTIVE_MS);
    expect(pollDelay('awaiting_approval')).toBe(LONG_TASK_WAITING_MS);
    expect(pollDelay('paused')).toBe(LONG_TASK_WAITING_MS);
    expect(pollDelay('completed')).toBeNull();
    expect(pollDelay('failed')).toBeNull();
    expect(pollDelay('cancelled')).toBeNull();
  });
});

describe('reading a task', () => {
  const raw = {
    id: ID,
    goal: 'Plan a weekend away',
    state: 'running',
    origin_session_id: 's1',
    created_at: '2026-10-28T09:00:00Z',
    updated_at: '2026-10-28T09:01:00Z',
    finished_at: null,
    steps: [
      { key: 'a', role: 'long-task-worker', state: 'completed', attempts: 1, summary: 'Found trains.', failure: null },
      { key: 'b', role: 'trip-planner', state: 'mystery', attempts: 0, summary: null, failure: null },
      { key: 'c', role: 'long-task-verifier', state: 'skipped', attempts: 0, summary: '', failure: null },
      { role: 'no key' },
    ],
    artifacts: [{ id: 'art1', task_id: ID, step_key: 'a', kind: 'findings', title: 'Trains', summary: 'Two a day.', tokens: 40, created_at: '' }],
    result_artifact_id: 'art1',
  };

  it('reads the contract, and an unknown step state as not started', () => {
    const task = readLongTask(raw);
    expect(task?.steps.map((s) => [s.key, s.state, s.summary])).toEqual([
      ['a', 'completed', 'Found trains.'],
      ['b', 'pending', null],
      ['c', 'skipped', null],
    ]);
    expect(task && resultArtifact(task)?.title).toBe('Trains');
    expect(progressOf(task!.steps)).toEqual({ done: 1, total: 3, skipped: 1 });
  });

  it('is null for a body that is not a task, or a task state it cannot say anything true about', () => {
    expect(readLongTask(null)).toBeNull();
    expect(readLongTask({ id: ID })).toBeNull();
    expect(readLongTask({ ...raw, state: 'sleeping' })).toBeNull();
  });
});

describe('where a task waits', () => {
  const raw = { id: ID, goal: 'Plan a weekend away', state: 'planning', steps: [], artifacts: [] };
  const queue = {
    position: 3,
    of: 4,
    ahead: [{ another_member: true }, { id: 'mine', goal: 'Find a plumber', state: 'running' }],
  };

  it("reads its place, and another member's task as a place only", () => {
    const task = readLongTask({ ...raw, queue })!;
    expect(task.queue).toEqual(queue);
    expect(isWaiting(task)).toBe(true);
    expect(queueChoices(task)).toEqual([
      { id: 'mine', goal: 'Find a plumber', position: 2, isThis: false },
      { id: ID, goal: 'Plan a weekend away', position: 3, isThis: true },
    ]);
  });

  it('never names a task from an entry it cannot read as one this member reaches', () => {
    const odd = { ...queue, ahead: [{ id: 'x', goal: 'Secret', state: 'dreaming' }, { another_member: true, id: 'y', goal: 'Also secret' }, 'z'] };
    expect(readLongTask({ ...raw, queue: odd })!.queue!.ahead).toEqual([{ another_member: true }, { another_member: true }, { another_member: true }]);
  });

  it('waits for nothing on an older Pond, at the front, once ended, or with a place it cannot read', () => {
    expect(readLongTask(raw)!.queue).toBeUndefined();
    expect(isWaiting(readLongTask(raw)!)).toBe(false);
    expect(isWaiting(readLongTask({ ...raw, queue: null })!)).toBe(false);
    expect(isWaiting(readLongTask({ ...raw, queue: { position: 1, of: 2, ahead: [] } })!)).toBe(false);
    expect(isWaiting(readLongTask({ ...raw, state: 'cancelled', queue })!)).toBe(false);
    expect(readLongTask({ ...raw, queue: { position: 'second', of: 2, ahead: [] } })!.queue).toBeNull();
  });

  it('offers no choice when only other members are ahead', () => {
    const task = readLongTask({ ...raw, queue: { position: 3, of: 3, ahead: [{ another_member: true }, { another_member: true }] } })!;
    expect(isWaiting(task)).toBe(true);
    expect(queueChoices(task)).toEqual([]);
  });
});

describe('the mock Pond', () => {
  function clock() {
    let t = Date.parse('2026-10-28T09:00:00Z');
    return { now: () => t, advance: (ms: number) => (t += ms) };
  }

  it('plans, runs each step, and finishes with a result to read', async () => {
    const c = clock();
    const pond = createMockLongTasks(c.now);
    const id = pond.start('Plan a weekend away');
    expect((await pond.task(id)).state).toBe('planning');

    c.advance(MOCK_PLANNING_MS);
    const running = await pond.task(id);
    expect(running.state).toBe('running');
    expect(running.steps.map((s) => s.state)).toEqual(['running', 'pending', 'pending']);

    c.advance(3 * MOCK_STEP_MS);
    const done = await pond.task(id);
    expect(done.state).toBe('completed');
    expect(done.result_artifact_id).not.toBeNull();
    expect((await pond.artifact(id, done.result_artifact_id!)).body).toMatch(/^## /);
  });

  it('stops a running task, and refuses to stop one that has ended', async () => {
    const c = clock();
    const pond = createMockLongTasks(c.now);
    const id = pond.start('Plan a weekend away');
    c.advance(MOCK_PLANNING_MS + MOCK_STEP_MS);
    await pond.cancel(id);
    const stopped = await pond.task(id);
    expect(stopped.state).toBe('cancelled');
    expect(stopped.steps.map((s) => s.state)).toEqual(['completed', 'skipped', 'skipped']);
    // Time passing does not carry a stopped task on.
    c.advance(10 * MOCK_STEP_MS);
    expect((await pond.task(id)).state).toBe('cancelled');
    await expect(pond.cancel(id)).rejects.toMatchObject({ status: 409 });
  });

  it('answers 404 for a task it does not have', async () => {
    await expect(createMockLongTasks().task('nope')).rejects.toMatchObject({ status: 404 });
  });

  it('works one task at a time, and a second waits its turn until the first is done', async () => {
    const c = clock();
    const pond = createMockLongTasks(c.now);
    const first = pond.start('Plan a weekend away');
    c.advance(1_000);
    const second = pond.start('Find a plumber');

    expect((await pond.task(first)).queue).toEqual({ position: 1, of: 2, ahead: [] });
    const waiting = await pond.task(second);
    expect(waiting.state).toBe('planning');
    expect(waiting.queue).toEqual({ position: 2, of: 2, ahead: [{ id: first, goal: 'Plan a weekend away', state: 'planning' }] });

    // Long past its own planning time, it has not started: the first still runs.
    c.advance(MOCK_PLANNING_MS + MOCK_STEP_MS);
    expect((await pond.task(second)).steps).toEqual([]);
    expect((await pond.task(second)).queue?.ahead).toEqual([{ id: first, goal: 'Plan a weekend away', state: 'running' }]);

    c.advance(2 * MOCK_STEP_MS);
    expect((await pond.task(first)).state).toBe('completed');
    expect((await pond.task(first)).queue).toBeNull();
    expect((await pond.task(second)).queue).toEqual({ position: 1, of: 1, ahead: [] });
    c.advance(MOCK_PLANNING_MS + 3 * MOCK_STEP_MS);
    expect((await pond.task(second)).state).toBe('completed');
  });

  it('brings the next task to the front when the one ahead is stopped, and can stop one still waiting', async () => {
    const c = clock();
    const pond = createMockLongTasks(c.now);
    const first = pond.start('Plan a weekend away');
    const second = pond.start('Find a plumber');
    const third = pond.start('Compare phone plans');
    expect((await pond.task(third)).queue?.position).toBe(3);

    await pond.cancel(second);
    expect((await pond.task(second)).state).toBe('cancelled');
    expect((await pond.task(third)).queue?.position).toBe(2);

    c.advance(MOCK_PLANNING_MS);
    await pond.cancel(first);
    const front = await pond.task(third);
    expect(front.queue).toEqual({ position: 1, of: 1, ahead: [] });
    c.advance(MOCK_PLANNING_MS);
    expect((await pond.task(third)).state).toBe('running');
  });

  it("holds another member's place in the line without naming it, and will not show or stop it", async () => {
    const pond = createMockLongTasks(clock().now);
    const theirs = pond.start('Their surprise party', 'general', { anotherMember: true });
    const mine = pond.start('Plan a weekend away');
    expect((await pond.task(mine)).queue).toEqual({ position: 2, of: 2, ahead: [{ another_member: true }] });
    await expect(pond.task(theirs)).rejects.toMatchObject({ status: 404 });
    await expect(pond.cancel(theirs)).rejects.toMatchObject({ status: 404 });
  });
});
