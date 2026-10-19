/**
 * The Automations tab's edits and deletes. `PUT /rules/{id}` replaces the whole
 * rule, so what is sent is the whole rule; the list shows the Pond's answer.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { Rule, RuleRequest } from '@/services/types';
import { useRules, type UseRules } from '@/view-models/use-rules';

jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: { listRules: jest.fn(), createRule: jest.fn(), updateRule: jest.fn(), deleteRule: jest.fn() },
  };
});

jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: true, isScreenReal: () => true }),
}));

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

const WARM: Rule = {
  id: 'rule-warm',
  name: 'Too warm',
  paused: false,
  currently_running: false,
  created_at: '2026-10-01T00:00:00Z',
  last_fired: null,
  cooldown_secs: 600,
  source: { kind: 'sensor', signal: 'temperature' },
  condition: { op: 'gt', value: 28 },
  actions: [{ type: 'notify', title: 'Warm', body: 'Above 28' }],
};

const EDIT: RuleRequest = {
  name: 'Too warm at night',
  source: { kind: 'sensor', signal: 'temperature' },
  condition: { op: 'gt', value: 26, after: '20:00', before: '06:00' },
  actions: [{ type: 'notify', title: 'Warm', body: 'Above 26' }],
  cooldown_secs: 600,
};

const mounted: ReactTestRenderer[] = [];

async function mount(): Promise<{ readonly vm: UseRules }> {
  let latest!: UseRules;
  const Probe = () => {
    latest = useRules();
    return null;
  };
  await act(async () => {
    mounted.push(create(<Probe />));
  });
  return {
    get vm() {
      return latest;
    },
  };
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.resetAllMocks();
  pond.listRules.mockResolvedValue([WARM]);
});

afterEach(async () => {
  for (const tree of mounted.splice(0)) await act(async () => tree.unmount());
});

describe('editing a rule', () => {
  it('sends the whole rule and shows what the Pond stored', async () => {
    const saved: Rule = { ...WARM, name: EDIT.name, condition: EDIT.condition, actions: EDIT.actions };
    pond.updateRule.mockResolvedValue(saved);
    const m = await mount();
    let refused: string | null = 'unset';
    await act(async () => {
      refused = await m.vm.actions.update(WARM, EDIT);
    });
    expect(pond.updateRule).toHaveBeenCalledWith('rule-warm', EDIT);
    expect(refused).toBeNull();
    expect(m.vm.data.rules).toEqual([saved]);
  });

  it('hands back why the Pond refused, and leaves the rule as it was', async () => {
    pond.updateRule.mockRejectedValue(
      new ApiError('x', 400, null, 'condition.after must be "HH:MM" (24-hour), got "8pm"'),
    );
    const m = await mount();
    let refused: string | null = null;
    await act(async () => {
      refused = await m.vm.actions.update(WARM, EDIT);
    });
    expect(refused).toBe('condition.after must be "HH:MM" (24-hour), got "8pm"');
    expect(m.vm.data.rules).toEqual([WARM]);
  });
});

describe('deleting a rule', () => {
  it('removes it once the Pond has', async () => {
    pond.deleteRule.mockResolvedValue(undefined);
    const m = await mount();
    let refused: string | null = 'unset';
    await act(async () => {
      refused = await m.vm.actions.remove(WARM);
    });
    expect(pond.deleteRule).toHaveBeenCalledWith('rule-warm');
    expect(refused).toBeNull();
    expect(m.vm.data.rules).toEqual([]);
  });

  /** Already gone is what was asked for. */
  it('takes a 404 as done', async () => {
    pond.deleteRule.mockRejectedValue(new ApiError('x', 404, null));
    const m = await mount();
    await act(async () => {
      await m.vm.actions.remove(WARM);
    });
    expect(m.vm.data.rules).toEqual([]);
  });

  it('keeps it, and says why, when the Pond refuses', async () => {
    pond.deleteRule.mockRejectedValue(new ApiError('x', 401, null));
    const m = await mount();
    let refused: string | null = null;
    await act(async () => {
      refused = await m.vm.actions.remove(WARM);
    });
    expect(refused).toBe(i18n.t('schedule.errors.deleteFailed'));
    expect(m.vm.data.rules).toEqual([WARM]);
  });
});
