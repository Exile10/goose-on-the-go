/**
 * The Activity screen's view-models against the Pond: how a filter becomes requests, how the
 * answers are narrowed and merged, and what a refusal says.
 *
 * The failure these exist for is a list that lies. A filter spanning several categories that
 * asked once and narrowed on the phone let the busiest category push every other one out; and a
 * Problems read the Pond refused showed "No problems", because a 403 said nothing and an empty
 * list read as a clean bill of health.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { ActivityEvent, LogEntry } from '@/services/types';
import type { ActivityFilter } from '@/models/log';
import { describeApiError } from '@/view-models/describe-error';
import { ACTIVITY_LIMIT, describeActivityError, useActivity, type UseActivity } from '@/view-models/use-activity';
import { useProblems, type UseProblems } from '@/view-models/use-problems';
import { useConversationTurns, type UseConversationTurns } from '@/view-models/use-conversation-telemetry';

jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: { listActivity: jest.fn(), clearActivity: jest.fn(), listLogs: jest.fn(), telemetryTurns: jest.fn() },
  };
});

const server = { hydrated: true, real: true };
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: server.hydrated, isScreenReal: () => server.real }),
}));

// The poll is use-live.test.ts's business; here it is one read on mount.
jest.mock('../use-live', () => ({
  useLive: (read: () => Promise<unknown>, _delay: unknown, enabled = true) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      if (enabled) void read();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);
  },
}));

const pond = jest.mocked(api);

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    category: 'device',
    action: 'device.state_changed',
    timestamp: '2026-10-05T09:00:00Z',
    privacy_sensitivity: 'internal',
    attributes: {},
    ...overrides,
  };
}

function log(id: number, level: string): LogEntry {
  return { id, timestamp: '2026-10-05 09:00:00', level, source: 'pond_server', message: `row ${id}`, metadata: null };
}

const notSetUp = () => new ApiError('GET /api/v1/logs → 403', 403, null, 'onboarding_required');

async function mount<T>(hook: () => T): Promise<{ readonly vm: T; unmount: () => Promise<void> }> {
  let latest!: T;
  const Probe = () => {
    latest = hook();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  return {
    get vm() {
      return latest;
    },
    unmount: async () => {
      await act(async () => tree.unmount());
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  server.hydrated = true;
  server.real = true;
});

describe('describeActivityError', () => {
  it('asks for setup when the Pond is not set up yet', () => {
    expect(describeActivityError(notSetUp())).toBe(i18n.t('activity.setupRequired'));
  });

  it('says the phone was refused on any other 403', () => {
    expect(describeActivityError(new ApiError('x', 403, null))).toBe(i18n.t('activity.forbidden'));
  });

  it('leaves everything else to the shared reading', () => {
    for (const e of [new ApiError('x', 401, null), new ApiError('x', 500, null), new TypeError('Network request failed')]) {
      expect(describeActivityError(e)).toBe(describeApiError(e));
    }
  });
});

describe('useActivity', () => {
  it('reads everything in one request under All', async () => {
    const events = [event({ category: 'tool', action: 'tool.call' }), event({})];
    pond.listActivity.mockResolvedValue({ count: 2, events });
    const m = await mount<UseActivity>(() => useActivity('all'));
    expect(pond.listActivity).toHaveBeenCalledTimes(1);
    expect(pond.listActivity).toHaveBeenCalledWith({ limit: ACTIVITY_LIMIT });
    expect(m.vm.data.events).toEqual(events);
    expect(m.vm.failed).toBe(false);
    await m.unmount();
  });

  it('asks once per category a filter spans and merges them newest first', async () => {
    pond.listActivity.mockImplementation(async (params) => {
      if (params?.category === 'sensor') return { count: 1, events: [event({ category: 'sensor', timestamp: '2026-10-05T08:00:00Z' })] };
      if (params?.category === 'device') return { count: 1, events: [event({ category: 'device', timestamp: '2026-10-05T10:00:00Z' })] };
      return { count: 0, events: [] };
    });
    const filter: ActivityFilter = 'home';
    const m = await mount<UseActivity>(() => useActivity(filter));
    const asked = pond.listActivity.mock.calls.map(([p]) => p?.category).sort();
    expect(asked).toEqual(['camera', 'device', 'sensor']);
    expect(m.vm.data.events.map((e) => e.category)).toEqual(['device', 'sensor']);
    await m.unmount();
  });

  it('reports a refused first read as unknown, with a sentence, not as an empty list', async () => {
    pond.listActivity.mockRejectedValue(notSetUp());
    const m = await mount<UseActivity>(() => useActivity('all'));
    expect(m.vm.failed).toBe(true);
    expect(m.vm.error).toBe(i18n.t('activity.setupRequired'));
    expect(m.vm.data.events).toEqual([]);
    await m.unmount();
  });

  it('clears through the Pond and reports how many went', async () => {
    pond.listActivity.mockResolvedValue({ count: 1, events: [event({})] });
    pond.clearActivity.mockResolvedValue({ purged: 7 });
    const m = await mount<UseActivity>(() => useActivity('all'));
    pond.listActivity.mockResolvedValue({ count: 0, events: [] });
    let purged = 0;
    await act(async () => {
      purged = await m.vm.actions.clear();
    });
    expect(pond.clearActivity).toHaveBeenCalledTimes(1);
    expect(purged).toBe(7);
    expect(m.vm.data.events).toEqual([]);
    await m.unmount();
  });

  it('asks the Pond nothing on mock', async () => {
    server.real = false;
    const m = await mount<UseActivity>(() => useActivity('all'));
    expect(pond.listActivity).not.toHaveBeenCalled();
    expect(m.vm.data.events.length).toBeGreaterThan(0);
    await m.unmount();
  });
});

describe('useProblems', () => {
  it('keeps warnings and errors and drops INFO', async () => {
    pond.listLogs.mockResolvedValue([log(1, 'INFO'), log(2, 'WARN'), log(3, 'error')]);
    const m = await mount<UseProblems>(() => useProblems(true));
    expect(m.vm.data.problems.map((p) => p.id)).toEqual([2, 3]);
    expect(m.vm.failed).toBe(false);
    await m.unmount();
  });

  /** THE regression: this showed "No problems" under a refusal. */
  it('marks a refused first read as failed and says why', async () => {
    pond.listLogs.mockRejectedValue(notSetUp());
    const m = await mount<UseProblems>(() => useProblems(true));
    expect(m.vm.failed).toBe(true);
    expect(m.vm.error).toBe(i18n.t('activity.setupRequired'));
    await m.unmount();
  });

  it('still marks an unreachable Pond as failed, leaving the sentence to the banner', async () => {
    pond.listLogs.mockRejectedValue(new TypeError('Network request failed'));
    const m = await mount<UseProblems>(() => useProblems(true));
    expect(m.vm.failed).toBe(true);
    expect(m.vm.error).toBeNull();
    await m.unmount();
  });

  it('reads nothing while the Problems filter is closed', async () => {
    const m = await mount<UseProblems>(() => useProblems(false));
    expect(pond.listLogs).not.toHaveBeenCalled();
    await m.unmount();
  });
});

describe('useConversationTurns', () => {
  it('says telemetry is off on a 503 rather than calling the Pond busy', async () => {
    pond.telemetryTurns.mockRejectedValue(new ApiError('x', 503, null, 'Telemetry is not enabled'));
    const m = await mount<UseConversationTurns>(() => useConversationTurns());
    await act(async () => {
      await m.vm.actions.load('s1');
    });
    expect(m.vm.error).toBe(i18n.t('activity.telemetry.off'));
    await m.unmount();
  });
});
