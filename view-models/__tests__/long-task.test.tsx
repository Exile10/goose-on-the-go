// A chat card follows its task on a poll, so these count requests: every 5 s while it plans or runs,
// 30 s while it waits, none once it ends, and none at all for an ended task already read.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import { forgetLongTasks } from '@/services/long-task-cache';
import type { LongTask, LongTaskState } from '@/services/types';
import { useLongTask, type UseLongTask } from '@/view-models/use-long-task';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect: run } = jest.requireActual('react');
    run(effect, [effect]);
  },
}));
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true, online: true, isScreenReal: () => true }) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { longTask: jest.fn(), cancelLongTask: jest.fn() } };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = 'task-0001-aaaa';

function task(state: LongTaskState, over: Partial<LongTask> = {}): LongTask {
  return {
    id: ID,
    kind: 'general',
    goal: 'Plan a weekend away',
    state,
    origin_session_id: 's1',
    created_at: '',
    updated_at: '',
    finished_at: null,
    steps: [],
    artifacts: [],
    result_artifact_id: null,
    ...over,
  };
}

async function mount() {
  let latest!: UseLongTask;
  const Probe = () => {
    latest = useLongTask(ID);
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
    await jest.advanceTimersByTimeAsync(0);
  });
  return {
    get vm() {
      return latest;
    },
    unmount: () => act(() => tree.unmount()),
  };
}

const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  // Not reset: that would also empty React Native's own AppState mock, which the poll listens on.
  jest.clearAllMocks();
  forgetLongTasks();
  pond.cancelLongTask.mockResolvedValue(undefined);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  warn.mockRestore();
});

describe('following a task', () => {
  it('reads every 5 s while it runs, and stops for good once it ends', async () => {
    pond.longTask.mockResolvedValue(task('running'));
    const m = await mount();
    expect(pond.longTask).toHaveBeenCalledTimes(1);
    expect(pond.longTask).toHaveBeenCalledWith(ID);

    await advance(5_000);
    expect(pond.longTask).toHaveBeenCalledTimes(2);

    pond.longTask.mockResolvedValue(task('completed'));
    await advance(5_000);
    expect(pond.longTask).toHaveBeenCalledTimes(3);
    expect(m.vm.task?.state).toBe('completed');

    await advance(10 * 60_000);
    expect(pond.longTask).toHaveBeenCalledTimes(3);
    await m.unmount();
  });

  it('reads every 30 s while it waits for a decision', async () => {
    pond.longTask.mockResolvedValue(task('awaiting_approval'));
    const m = await mount();
    await advance(29_999);
    expect(pond.longTask).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(pond.longTask).toHaveBeenCalledTimes(2);
    await m.unmount();
  });

  it('asks nothing again for a task it has already seen end, when its card is shown again', async () => {
    pond.longTask.mockResolvedValue(task('failed'));
    const first = await mount();
    await first.unmount();
    expect(pond.longTask).toHaveBeenCalledTimes(1);

    const again = await mount();
    await advance(60_000);
    expect(pond.longTask).toHaveBeenCalledTimes(1);
    expect(again.vm.task?.state).toBe('failed');
    await again.unmount();
  });

  it('stops asking about a task the Pond does not have, and says so', async () => {
    pond.longTask.mockRejectedValue(new ApiError('GET → 404', 404, null));
    const m = await mount();
    await advance(10 * 60_000);
    expect(pond.longTask).toHaveBeenCalledTimes(1);
    expect(m.vm.gone).toBe(true);
    await m.unmount();
  });

  it('says it could not read a task it has never seen, and keeps trying at the slow pace', async () => {
    pond.longTask.mockRejectedValue(new ApiError('GET → 503', 503, null));
    const m = await mount();
    expect(m.vm.error).toBe('Your Pond is busy. Try again in a moment.');
    await advance(29_999);
    expect(pond.longTask).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(pond.longTask).toHaveBeenCalledTimes(2);
    await m.unmount();
  });
});

describe('stopping a task', () => {
  it('asks the Pond once, then reads the task once to show it stopped', async () => {
    pond.longTask.mockResolvedValue(task('running'));
    const m = await mount();
    pond.longTask.mockResolvedValue(task('cancelled'));
    let stopped = false;
    await act(async () => {
      stopped = await m.vm.actions.stop();
    });
    expect(stopped).toBe(true);
    expect(pond.cancelLongTask).toHaveBeenCalledTimes(1);
    expect(pond.cancelLongTask).toHaveBeenCalledWith(ID);
    expect(pond.longTask).toHaveBeenCalledTimes(2);
    expect(m.vm.task?.state).toBe('cancelled');
    await m.unmount();
  });

  it('says a task that had already ended had, and shows how it ended', async () => {
    pond.longTask.mockResolvedValue(task('running'));
    pond.cancelLongTask.mockRejectedValue(new ApiError('POST → 409', 409, null));
    const m = await mount();
    pond.longTask.mockResolvedValue(task('completed'));
    await act(async () => {
      await m.vm.actions.stop();
    });
    expect(m.vm.notice).toBe('It had already ended.');
    expect(m.vm.stopError).toBeNull();
    expect(m.vm.task?.state).toBe('completed');
    await m.unmount();
  });

  it('keeps the task as it was and says why when the Pond cannot stop it', async () => {
    pond.longTask.mockResolvedValue(task('running'));
    pond.cancelLongTask.mockRejectedValue(new ApiError('POST → 500', 500, null));
    const m = await mount();
    await act(async () => {
      await m.vm.actions.stop();
    });
    expect(m.vm.stopError).toBe('Your Pond is busy. Try again in a moment.');
    expect(m.vm.task?.state).toBe('running');
    await m.unmount();
  });
});
