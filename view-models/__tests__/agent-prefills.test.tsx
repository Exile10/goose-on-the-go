// Home is the screen left open longest on a rate-limited Pond, so these count requests: quick during a
// pass, slow otherwise, none for a Pond without the route or out of reach.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import type { AgentPrefills, PrefillBuilding } from '@/services/types';
import { PREFILLS_BUILDING_MS, PREFILLS_HOME_MS, useAgentsBuilding } from '@/view-models/use-agent-prefills';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    // Home in front for the whole test: the effect runs as on focus, and again when its inputs change.
    const { useEffect: run } = jest.requireActual('react');
    run(effect, [effect]);
  },
}));
const server = { hydrated: true, online: true, isScreenReal: () => true };
jest.mock('@/providers/server-provider', () => ({ useServer: () => server }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { agentPrefills: jest.fn() } };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IDLE: AgentPrefills = { building: { active: false, current: null, done: 0, total: 0 }, retention_days: 14, agents: [] };
const BUSY: AgentPrefills = { ...IDLE, building: { active: true, current: 'planner', done: 1, total: 3 } };

async function mount() {
  let latest: PrefillBuilding | null = null;
  const Probe = () => {
    latest = useAgentsBuilding();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
    await jest.advanceTimersByTimeAsync(0);
  });
  return {
    get building() {
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
  server.online = true;
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  warn.mockRestore();
});

it('asks once on arrival, then every 30 s while nothing compiles, and shows nothing', async () => {
  pond.agentPrefills.mockResolvedValue(IDLE);
  const m = await mount();
  expect(pond.agentPrefills).toHaveBeenCalledTimes(1);
  expect(m.building).toBeNull();

  await advance(PREFILLS_HOME_MS - 1);
  expect(pond.agentPrefills).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(pond.agentPrefills).toHaveBeenCalledTimes(2);
  await m.unmount();
});

it('shows a running pass and follows it every 5 s until it ends', async () => {
  pond.agentPrefills.mockResolvedValue(BUSY);
  const m = await mount();
  expect(m.building).toEqual({ active: true, current: 'planner', done: 1, total: 3 });

  await advance(PREFILLS_BUILDING_MS);
  expect(pond.agentPrefills).toHaveBeenCalledTimes(2);

  pond.agentPrefills.mockResolvedValue(IDLE);
  await advance(PREFILLS_BUILDING_MS);
  expect(pond.agentPrefills).toHaveBeenCalledTimes(3);
  expect(m.building).toBeNull();

  // Back to the slow pace once the pass is over.
  await advance(PREFILLS_BUILDING_MS);
  expect(pond.agentPrefills).toHaveBeenCalledTimes(3);
  await m.unmount();
});

it('stops asking a Pond that has no prefill route', async () => {
  pond.agentPrefills.mockRejectedValue(new ApiError('GET /api/v1/agents/prefills → 404', 404, null));
  const m = await mount();
  await advance(10 * 60_000);
  expect(pond.agentPrefills).toHaveBeenCalledTimes(1);
  expect(m.building).toBeNull();
  await m.unmount();
});

it('keeps asking at the slow pace after an ordinary failure, without asking sooner', async () => {
  pond.agentPrefills.mockRejectedValue(new ApiError('GET /api/v1/agents/prefills → 503', 503, null));
  const m = await mount();
  await advance(PREFILLS_HOME_MS - 1);
  expect(pond.agentPrefills).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(pond.agentPrefills).toHaveBeenCalledTimes(2);
  await m.unmount();
});

it('asks nothing of a Pond out of reach', async () => {
  server.online = false;
  pond.agentPrefills.mockResolvedValue(BUSY);
  const m = await mount();
  await advance(PREFILLS_HOME_MS * 4);
  expect(pond.agentPrefills).not.toHaveBeenCalled();
  expect(m.building).toBeNull();
  await m.unmount();
});
