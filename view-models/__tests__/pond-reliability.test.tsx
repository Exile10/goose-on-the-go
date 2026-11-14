// The reliability page: read once My Pond is open, read again for 30 days, and returned to the lock
// like every other admin screen. Never polled, since each read renews the unlock.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import type { AdminReliability, AdminStatus } from '@/services/types';
import { resetMockPondAdmin } from '@/view-models/pond-admin-source';
import { resetAdminGates } from '@/view-models/use-admin-gate';
import { usePondReliability, type UsePondReliability } from '@/view-models/use-pond-reliability';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect: run } = jest.requireActual('react');
    run(effect, [effect]);
  },
}));
const server = { hydrated: true, online: true, real: true, isScreenReal: () => server.real };
jest.mock('@/providers/server-provider', () => ({ useServer: () => server }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { adminStatus: jest.fn(), adminReliability: jest.fn() } };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPEN: AdminStatus = {
  card: 'present',
  unlocked: true,
  expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  idle_minutes: 15,
  retry_after: null,
  key: false,
  keys: true,
};

const report = (days: number): AdminReliability => ({
  days,
  notices: { queued: 20, woken: 14, fetched: 19, fetched_within_a_minute: 9, fetched_after_an_hour: 2, shown: 18, opened: 6, spoken: 1 },
  turns: { asked: 40, answered: 39 },
  phones: { paired: 3, test: 0, unseen: 1, with_push_token: 2 },
  stops: 1,
  android_push_key: true,
  apple_push_key: false,
});

const flush = () => act(async () => jest.advanceTimersByTimeAsync(0));

async function mount() {
  let latest!: UsePondReliability;
  const Probe = () => {
    latest = usePondReliability();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  await flush();
  return {
    get vm() {
      return latest;
    },
    unmount: () => act(() => tree.unmount()),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  resetAdminGates();
  resetMockPondAdmin();
  server.real = true;
  pond.adminStatus.mockResolvedValue(OPEN);
  pond.adminReliability.mockImplementation(async (days: number) => report(days));
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('reads the last 7 days once My Pond is open, and then reads nothing more by itself', async () => {
  const page = await mount();
  expect(pond.adminReliability.mock.calls).toEqual([[7]]);
  expect(page.vm.report?.days).toBe(7);
  await act(async () => jest.advanceTimersByTimeAsync(10 * 60_000));
  expect(pond.adminReliability).toHaveBeenCalledTimes(1);
  page.unmount();
});

it('reads the last 30 days when asked, and once only', async () => {
  const page = await mount();
  await act(async () => page.vm.actions.setDays(30));
  await flush();
  expect(pond.adminReliability.mock.calls).toEqual([[7], [30]]);
  expect(page.vm.days).toBe(30);
  expect(page.vm.report?.days).toBe(30);
  await act(async () => page.vm.actions.setDays(30));
  await flush();
  expect(pond.adminReliability).toHaveBeenCalledTimes(2);
  page.unmount();
});

it('keeps a slow answer for 7 days from landing over the 30 asked after it', async () => {
  let answerWeek!: (r: AdminReliability) => void;
  pond.adminReliability.mockImplementationOnce(() => new Promise((resolve) => { answerWeek = resolve; }));
  const page = await mount();
  await act(async () => page.vm.actions.setDays(30));
  await flush();
  await act(async () => answerWeek(report(7)));
  await flush();
  expect(page.vm.report?.days).toBe(30);
  page.unmount();
});

it('goes back to the lock when the Pond says My Pond has locked', async () => {
  pond.adminReliability.mockRejectedValue(new ApiError('admin → 403', 403, null, 'admin_locked', { error: 'admin_locked' }));
  const page = await mount();
  expect(page.vm.gate.phase).toBe('locked');
  expect(page.vm.report).toBeNull();
  page.unmount();
});

it('says the report could not be read when the Pond fails', async () => {
  pond.adminReliability.mockRejectedValue(new ApiError('admin → 500', 500, null));
  const page = await mount();
  expect(page.vm.error).toBeTruthy();
  expect(page.vm.loading).toBe(false);
  page.unmount();
});

it('reads the mock Pond on mock, and asks the real one nothing', async () => {
  server.real = false;
  const page = await mount();
  expect(pond.adminReliability).not.toHaveBeenCalled();
  // The mock opens only with its card, so it is locked here; its report is the mock test's.
  expect(page.vm.gate.phase).toBe('locked');
  page.unmount();
});
