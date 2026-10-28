// A waiting task's card lets the member keep going or stop each of their own tasks in the line, and
// one Stop applies the choice. These pin what it asks the Pond: only the picked ids, each once.

import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { LongTaskQueue } from '@/components/patterns/long-task-queue';
import { ApiError, api } from '@/services/api-client';
import type { LongTask, LongTaskQueuePlace } from '@/services/types';
import { mockLongTasks, resetMockLongTasks } from '@/view-models/use-long-task';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/haptics', () => ({
  confirm: jest.fn().mockResolvedValue(undefined),
  reject: jest.fn().mockResolvedValue(undefined),
  selectionTick: jest.fn().mockResolvedValue(undefined),
  tap: jest.fn().mockResolvedValue(undefined),
}));
const server = { hydrated: true, online: true, real: true, isScreenReal: () => server.real };
jest.mock('@/providers/server-provider', () => ({ useServer: () => server }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { longTask: jest.fn(), cancelLongTask: jest.fn() } };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THIS = 'task-this';

function task(queue: LongTaskQueuePlace | null | undefined, over: Partial<LongTask> = {}): LongTask {
  return {
    id: THIS,
    kind: 'research',
    goal: 'Compare phone plans',
    state: 'planning',
    origin_session_id: 's1',
    created_at: '',
    updated_at: '',
    finished_at: null,
    steps: [],
    artifacts: [],
    result_artifact_id: null,
    queue,
    ...over,
  };
}

/** Two of the member's own ahead, with another member's task between them. */
const LINE: LongTaskQueuePlace = {
  position: 4,
  of: 4,
  ahead: [
    { id: 'trip', goal: 'Plan a weekend away', state: 'running' },
    { another_member: true },
    { id: 'plumber', goal: 'Find a plumber', state: 'planning' },
  ],
};

async function draw(t: LongTask, refresh = jest.fn().mockResolvedValue(undefined)) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<LongTaskQueue task={t} refresh={refresh} />);
  });
  return { tree, refresh };
}

function words(node: ReactTestInstance | ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: ReactTestInstance | string) => {
    if (typeof n === 'string') out.push(n);
    else n.children.forEach(walk);
  };
  walk('root' in node ? node.root : node);
  return out.join(' ');
}

const host = (n: ReactTestInstance) => typeof n.type === 'string';

function groups(tree: ReactTestRenderer): ReactTestInstance[] {
  return tree.root.findAll((n) => host(n) && n.props.accessibilityRole === 'radiogroup');
}

function option(tree: ReactTestRenderer, group: string, label: 'Keep going' | 'Stop'): ReactTestInstance {
  const found = groups(tree).find((g) => g.props.accessibilityLabel === group);
  if (!found) throw new Error(`no choice for ${group}`);
  const radios = found.findAll((n) => n.props.accessibilityRole === 'radio' && typeof n.props.onPress === 'function');
  const radio = radios.find((r) => words(r) === label);
  if (!radio) throw new Error(`no ${label} in ${group}`);
  return radio;
}

function button(tree: ReactTestRenderer, label: string): ReactTestInstance | undefined {
  return tree.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function').find((b) => words(b) === label);
}

const press = (n: ReactTestInstance) => act(async () => n.props.onPress());

let warn: jest.SpyInstance;

beforeEach(() => {
  server.real = true;
  jest.clearAllMocks();
  pond.cancelLongTask.mockResolvedValue(undefined);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('nothing to show', () => {
  it('shows nothing at the front of the line, once ended, or from a Pond that does not say', async () => {
    for (const t of [
      task({ position: 1, of: 3, ahead: [] }),
      task(LINE, { state: 'cancelled' }),
      task(null),
      task(undefined),
    ]) {
      const { tree } = await draw(t);
      expect(tree.toJSON()).toBeNull();
    }
  });
});

describe("only other members' tasks ahead", () => {
  it('says how many are ahead, offers no choice, and names none of them', async () => {
    const { tree } = await draw(task({ position: 3, of: 3, ahead: [{ another_member: true }, { another_member: true }] }));
    expect(words(tree)).toBe('Ahead of this one: 2 for other members.');
    expect(groups(tree)).toHaveLength(0);
    expect(button(tree, 'Stop 1 task')).toBeUndefined();
  });
});

describe("the member's own tasks ahead", () => {
  it('offers keep or stop for each of them and this one, keeping everything going until asked', async () => {
    const { tree } = await draw(task(LINE));
    const text = words(tree);
    expect(text).toContain('Ahead of this one: 2 of your tasks and 1 for another member.');
    expect(text).toContain('The pond works through these one at a time. Choose which keep going; a task you stop finishes the step it is on.');
    expect(text).toContain('Everything here keeps going.');
    expect(groups(tree).map((g) => g.props.accessibilityLabel)).toEqual([
      'Plan a weekend away, Working now',
      'Find a plumber, 3rd in line',
      'Compare phone plans (this one), 4th in line',
    ]);
    for (const group of groups(tree)) {
      const checked = group
        .findAll((n) => host(n) && n.props.accessibilityRole === 'radio')
        .map((r) => [words(r), r.props.accessibilityState?.checked]);
      expect(checked).toEqual([
        ['Keep going', true],
        ['Stop', false],
      ]);
    }
    expect(button(tree, 'Stop 1 task')).toBeUndefined();
  });

  it('stops exactly the picked tasks with one press, then reads this task again', async () => {
    const { tree, refresh } = await draw(task(LINE));
    await press(option(tree, 'Plan a weekend away, Working now', 'Stop'));
    expect(words(tree)).not.toContain('Everything here keeps going.');
    expect(button(tree, 'Stop 1 task')).toBeDefined();
    await press(option(tree, 'Compare phone plans (this one), 4th in line', 'Stop'));
    // Changing a mind takes a task back out.
    await press(option(tree, 'Find a plumber, 3rd in line', 'Stop'));
    await press(option(tree, 'Find a plumber, 3rd in line', 'Keep going'));
    expect(pond.cancelLongTask).not.toHaveBeenCalled();

    await press(button(tree, 'Stop 2 tasks')!);
    expect(pond.cancelLongTask).toHaveBeenCalledTimes(2);
    expect(pond.cancelLongTask.mock.calls.map(([id]) => id)).toEqual(['trip', THIS]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(words(tree)).toContain('Stopped 2 tasks.');
    expect(button(tree, 'Stop 2 tasks')).toBeUndefined();
  });

  it('counts a task that had already ended as stopped', async () => {
    pond.cancelLongTask.mockImplementation(async (id: string) => {
      if (id === 'plumber') throw new ApiError('POST → 409', 409, null, 'the task has already completed');
    });
    const { tree } = await draw(task(LINE));
    await press(option(tree, 'Plan a weekend away, Working now', 'Stop'));
    await press(option(tree, 'Find a plumber, 3rd in line', 'Stop'));
    await press(button(tree, 'Stop 2 tasks')!);
    expect(words(tree)).toContain('Stopped 2 tasks.');
    expect(words(tree)).not.toContain('Could not stop');
  });

  it('says which could not be stopped and why, and keeps only that one picked to try again', async () => {
    pond.cancelLongTask.mockImplementation(async (id: string) => {
      if (id === 'plumber') throw new ApiError('POST → 503', 503, null);
    });
    const { tree } = await draw(task(LINE));
    await press(option(tree, 'Plan a weekend away, Working now', 'Stop'));
    await press(option(tree, 'Find a plumber, 3rd in line', 'Stop'));
    await press(button(tree, 'Stop 2 tasks')!);
    expect(words(tree)).toContain('Stopped 1 task.');
    expect(words(tree)).toContain('Could not stop Find a plumber: your Pond is busy. Try again.');

    pond.cancelLongTask.mockClear();
    await press(button(tree, 'Stop 1 task')!);
    expect(pond.cancelLongTask.mock.calls).toEqual([['plumber']]);
  });

  it('asks the Pond nothing for a pick whose task has since left the line', async () => {
    const { tree } = await draw(task(LINE));
    await press(option(tree, 'Plan a weekend away, Working now', 'Stop'));
    await press(option(tree, 'Find a plumber, 3rd in line', 'Stop'));
    // The trip finished before Stop was pressed.
    const later: LongTaskQueuePlace = { position: 3, of: 3, ahead: [LINE.ahead[1], LINE.ahead[2]] };
    await act(async () => {
      tree.update(<LongTaskQueue task={task(later)} refresh={jest.fn().mockResolvedValue(undefined)} />);
    });
    await press(button(tree, 'Stop 1 task')!);
    expect(pond.cancelLongTask.mock.calls).toEqual([['plumber']]);
  });
});

describe('on the mock Pond', () => {
  beforeEach(() => {
    server.real = false;
    resetMockLongTasks();
  });

  it('stops the task ahead, and this one moves to the front', async () => {
    const mock = mockLongTasks();
    const first = mock.start('Plan a weekend away');
    const second = mock.start('Compare phone plans');
    const waiting = await mock.task(second);
    expect(waiting.queue?.position).toBe(2);

    const refresh = jest.fn().mockResolvedValue(undefined);
    const { tree } = await draw(waiting, refresh);
    await press(option(tree, 'Plan a weekend away, Working now', 'Stop'));
    await press(button(tree, 'Stop 1 task')!);

    expect(pond.cancelLongTask).not.toHaveBeenCalled();
    expect((await mock.task(first)).state).toBe('cancelled');
    expect((await mock.task(second)).queue).toEqual({ position: 1, of: 1, ahead: [] });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
