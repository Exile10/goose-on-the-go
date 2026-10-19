/**
 * One schedule's screen: finding it in the Pond's list, what an edit sends and
 * what it leaves on screen, and pause, run now and delete, each against the
 * answer the Pond gives rather than the one the screen hoped for.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { Schedule, ScheduleRun } from '@/services/types';
import { useScheduleDetail, type UseScheduleDetail } from '@/view-models/use-schedule-detail';

jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      listSchedules: jest.fn(),
      listScheduleRuns: jest.fn(),
      updateSchedule: jest.fn(),
      pauseSchedule: jest.fn(),
      resumeSchedule: jest.fn(),
      runScheduleNow: jest.fn(),
      deleteSchedule: jest.fn(),
    },
  };
});

const server = { hydrated: true, real: true };
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: server.hydrated, isScreenReal: () => server.real }),
}));

// The poll is `use-live.test.ts`'s business; here it is a read on mount, kept so a test can fire one.
let poll: (() => Promise<unknown>) | null = null;
jest.mock('../use-live', () => ({
  MIN_POLL_MS: 5_000,
  useLive: (read: () => Promise<unknown>, _delay: unknown, enabled = true) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    poll = read;
    useEffect(() => {
      if (enabled) void read();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);
  },
}));

const pond = jest.mocked(api);

const BRIEF: Schedule = {
  id: 'daily-brief',
  label: 'Daily Brief',
  cron: '0 0 7 * * *',
  fire_at: null,
  timezone: 'Africa/Nairobi',
  kind: { type: 'agent_prompt', prompt: 'Brief me' },
  paused: false,
  currently_running: false,
  last_run: '2026-10-19T04:00:00Z',
  next_run: '2026-10-20T04:00:00Z',
  created_at: '2026-10-01T00:00:00Z',
};

const RUN: ScheduleRun = {
  id: 'run-1',
  schedule_id: 'daily-brief',
  status: 'completed',
  result: 'Sunny, two meetings.',
  error: null,
  started_at: '2026-10-19T04:00:00Z',
  finished_at: '2026-10-19T04:00:09Z',
  duration_ms: 9000,
};

interface Mounted {
  readonly vm: UseScheduleDetail;
}

async function mount(id = 'daily-brief'): Promise<Mounted> {
  let latest!: UseScheduleDetail;
  const Probe = () => {
    latest = useScheduleDetail(id);
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  mounted.push(tree);
  return {
    get vm() {
      return latest;
    },
  };
}

const mounted: ReactTestRenderer[] = [];

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.resetAllMocks();
  server.hydrated = true;
  server.real = true;
  poll = null;
  pond.listSchedules.mockResolvedValue([BRIEF]);
  pond.listScheduleRuns.mockResolvedValue([RUN]);
});

afterEach(async () => {
  for (const tree of mounted.splice(0)) await act(async () => tree.unmount());
});

describe('reading one schedule', () => {
  it('finds it in the Pond\'s list, with its runs and what they said', async () => {
    const m = await mount();
    expect(m.vm.schedule).toEqual(BRIEF);
    expect(m.vm.missing).toBe(false);
    expect(pond.listScheduleRuns).toHaveBeenCalledWith('daily-brief', expect.any(Number));
    expect(m.vm.runs.data.runs).toEqual([RUN]);
  });

  it('says it is gone when the Pond no longer has it', async () => {
    pond.listSchedules.mockResolvedValue([]);
    const m = await mount();
    expect(m.vm.schedule).toBeNull();
    expect(m.vm.missing).toBe(true);
    expect(pond.listScheduleRuns).not.toHaveBeenCalled();
  });

  /** `GET /schedules` returns rules too; a rule's id must not open as a schedule. */
  it('does not open a rule as a schedule', async () => {
    pond.listSchedules.mockResolvedValue([
      { ...BRIEF, cron: '@event', kind: { type: 'sensor_trigger', source: { kind: 'sensor' }, actions: [] } },
    ]);
    const m = await mount();
    expect(m.vm.missing).toBe(true);
  });

  it('reads the history again when a run it watched has finished', async () => {
    pond.listSchedules.mockResolvedValue([{ ...BRIEF, currently_running: true }]);
    await mount();
    expect(pond.listScheduleRuns).toHaveBeenCalledTimes(1);
    pond.listSchedules.mockResolvedValue([BRIEF]);
    await act(async () => {
      await poll?.();
    });
    expect(pond.listScheduleRuns).toHaveBeenCalledTimes(2);
  });

  it('is unknown, not gone, when the first read fails', async () => {
    pond.listSchedules.mockRejectedValue(new ApiError('x', 503, null));
    const m = await mount();
    expect(m.vm.failed).toBe(true);
    expect(m.vm.missing).toBe(false);
    expect(m.vm.error).toBe(i18n.t('schedule.errors.noScheduler'));
  });
});

describe('editing it', () => {
  it('sends the change and shows the Pond\'s answer', async () => {
    const saved = { ...BRIEF, label: 'Morning Brief' };
    pond.updateSchedule.mockResolvedValue(saved);
    const m = await mount();
    let refused: string | null = 'unset';
    await act(async () => {
      refused = await m.vm.actions.update({ name: 'Morning Brief' });
    });
    expect(pond.updateSchedule).toHaveBeenCalledWith('daily-brief', { name: 'Morning Brief' });
    expect(refused).toBeNull();
    expect(m.vm.schedule).toEqual(saved);
    expect(m.vm.notice).toBe('saved');
  });

  it('sends nothing for an edit that changed nothing', async () => {
    const m = await mount();
    await act(async () => {
      await m.vm.actions.update({});
    });
    expect(pond.updateSchedule).not.toHaveBeenCalled();
  });

  /** A 400 names the field the scheduler disliked, so that is what the form shows. */
  it('hands back why the Pond refused, and keeps the schedule as it was', async () => {
    pond.updateSchedule.mockRejectedValue(new ApiError('x', 400, null, 'invalid cron expression'));
    const m = await mount();
    let refused: string | null = null;
    await act(async () => {
      refused = await m.vm.actions.update({ cron: '0 0 99 * * *' });
    });
    expect(refused).toBe('invalid cron expression');
    expect(m.vm.schedule).toEqual(BRIEF);
    expect(m.vm.notice).toBeNull();
  });

  it('still says something when the refusal has no sentence of its own', async () => {
    pond.updateSchedule.mockRejectedValue(new ApiError('x', 401, null));
    const m = await mount();
    let refused: string | null = null;
    await act(async () => {
      refused = await m.vm.actions.update({ name: 'x' });
    });
    expect(refused).toBe(i18n.t('schedule.errors.saveFailed'));
  });
});

describe('the other actions', () => {
  it('puts the switch back when the Pond refuses a pause', async () => {
    pond.pauseSchedule.mockRejectedValue(new ApiError('x', 404, null));
    const m = await mount();
    await act(async () => {
      await m.vm.actions.setPaused(true);
    });
    expect(pond.pauseSchedule).toHaveBeenCalledWith('daily-brief');
    expect(m.vm.schedule?.paused).toBe(false);
    expect(m.vm.error).toBe(i18n.t('schedule.errors.gone'));
  });

  it('runs it now, once per tap that the Pond has answered', async () => {
    pond.runScheduleNow.mockResolvedValue(undefined);
    const m = await mount();
    await act(async () => {
      await Promise.all([m.vm.actions.runNow(), m.vm.actions.runNow()]);
    });
    expect(pond.runScheduleNow).toHaveBeenCalledTimes(1);
    expect(m.vm.schedule?.currently_running).toBe(true);
    expect(m.vm.notice).toBe('runStarted');
  });

  it('deletes it', async () => {
    pond.deleteSchedule.mockResolvedValue(undefined);
    const m = await mount();
    let gone = false;
    await act(async () => {
      gone = await m.vm.actions.remove();
    });
    expect(pond.deleteSchedule).toHaveBeenCalledWith('daily-brief');
    expect(gone).toBe(true);
    expect(m.vm.missing).toBe(true);
  });

  it('stays, and says why, when the Pond refuses a delete', async () => {
    pond.deleteSchedule.mockRejectedValue(new ApiError('x', 500, null));
    const m = await mount();
    let gone = true;
    await act(async () => {
      gone = await m.vm.actions.remove();
    });
    expect(gone).toBe(false);
    expect(m.vm.schedule).toEqual(BRIEF);
    expect(m.vm.error).toBe(i18n.t('errors.busy'));
  });
});

describe('on mock', () => {
  it('opens a sample and changes it locally, with nothing sent', async () => {
    server.real = false;
    const m = await mount('sample-morning');
    expect(m.vm.schedule?.label).toBe('Morning briefing');
    await act(async () => {
      await m.vm.actions.update({ name: 'Renamed' });
    });
    expect(m.vm.schedule?.label).toBe('Renamed');
    expect(pond.listSchedules).not.toHaveBeenCalled();
    expect(pond.updateSchedule).not.toHaveBeenCalled();
  });
});
