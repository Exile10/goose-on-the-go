// Each action is one request and one re-read, never a burst, so these count calls.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import type { AgentPrefills, AgentRecipe, AgentSuggestion } from '@/services/types';
import { resetMockAgents } from '@/view-models/agents-source';
import { useAgents, type UseAgents } from '@/view-models/use-agents';

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
  return {
    ...actual,
    api: {
      listRecipes: jest.fn(),
      listAgentSuggestions: jest.fn(),
      agentPrefills: jest.fn(),
      rebuildAgentPrefill: jest.fn(),
      rebuildAllPrefills: jest.fn(),
      enableAgentSuggestion: jest.fn(),
      dismissAgentSuggestion: jest.fn(),
    },
  };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BRIEF: AgentRecipe = {
  id: 'r1',
  name: 'morning-brief',
  yaml: 'title: Morning brief\ngiap_role:\n  instructions: Brief the house.\n  activations:\n    - schedule: { cron: "0 0 7 * * *", brief: "Go." }\n',
};
const PLAIN: AgentRecipe = { id: 'r2', name: 'lock-up', yaml: 'title: Lock up\nprompt: Lock the doors\n' };
const PREFILLS: AgentPrefills = {
  building: { active: false, current: null, done: 0, total: 0 },
  retention_days: 14,
  agents: [
    { agent: 'long-task-planner', kind: 'default', status: 'ready', compiled_at: null, last_used_at: null },
    { agent: 'morning-brief', kind: 'member', status: 'idle', compiled_at: null, last_used_at: null },
  ],
};
const GATE: AgentSuggestion = {
  template: 'late_night_gate_alert',
  title: 'Late-night gate alert',
  description: 'Tells you when a camera sees someone at night.',
  why: 'Your Pond has a camera.',
  needs: ['a camera'],
  activations_summary: 'When a camera sees a person, between 22:00 and 06:00',
};

async function mount() {
  let latest!: UseAgents;
  const Probe = () => {
    latest = useAgents();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return {
    get vm() {
      return latest;
    },
    unmount: () => act(() => tree.unmount()),
  };
}

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  resetMockAgents();
  server.real = true;
  pond.listRecipes.mockResolvedValue([BRIEF, PLAIN]);
  pond.listAgentSuggestions.mockResolvedValue([GATE]);
  pond.agentPrefills.mockResolvedValue(PREFILLS);
  pond.rebuildAgentPrefill.mockResolvedValue(undefined);
  pond.rebuildAllPrefills.mockResolvedValue(undefined);
  pond.dismissAgentSuggestion.mockResolvedValue(undefined);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => warn.mockRestore());

describe('the list', () => {
  it('shows the agents with their prefills, the built-in helpers and the suggestions, from one read each', async () => {
    const m = await mount();
    expect(m.vm.loading).toBe(false);
    expect(m.vm.data.agents.map((a) => [a.name, a.title, a.startsByItself, a.prefill?.status])).toEqual([
      ['morning-brief', 'Morning brief', true, 'idle'],
    ]);
    expect(m.vm.data.builtIn.map((p) => p.agent)).toEqual(['long-task-planner']);
    expect(m.vm.data.suggestions).toEqual([GATE]);
    expect(m.vm.data.prefillsReported).toBe(true);
    expect(pond.listRecipes).toHaveBeenCalledTimes(1);
    expect(pond.agentPrefills).toHaveBeenCalledTimes(1);
    expect(pond.listAgentSuggestions).toHaveBeenCalledTimes(1);
    await m.unmount();
  });

  it('still lists the agents on a Pond without prefill routes, and says it cannot report them', async () => {
    pond.agentPrefills.mockRejectedValue(new ApiError('GET → 404', 404, null));
    const m = await mount();
    expect(m.vm.data.agents.map((a) => a.name)).toEqual(['morning-brief']);
    expect(m.vm.data.prefillsReported).toBe(false);
    expect(m.vm.error).toBeNull();
    await m.unmount();
  });

  it('offers no suggestions, quietly, on a Pond without them', async () => {
    pond.listAgentSuggestions.mockRejectedValue(new ApiError('GET → 404', 404, null));
    const m = await mount();
    expect(m.vm.data.suggestions).toEqual([]);
    expect(m.vm.error).toBeNull();
    await m.unmount();
  });

  it('says it could not read the list, rather than showing it empty', async () => {
    pond.listRecipes.mockRejectedValue(new TypeError('Network request failed'));
    const m = await mount();
    expect(m.vm.failed).toBe(true);
    expect(m.vm.data.agents).toEqual([]);
    await m.unmount();
  });

  it('names the agent being compiled now', async () => {
    pond.agentPrefills.mockResolvedValue({ ...PREFILLS, building: { active: true, current: 'morning-brief', done: 0, total: 2 } });
    const m = await mount();
    expect(m.vm.data.building).toEqual({ active: true, current: 'morning-brief', done: 0, total: 2 });
    expect(m.vm.data.buildingName).toBe('Morning brief');
    await m.unmount();
  });
});

describe('rebuilding', () => {
  it('asks once for one agent, says so, and reads the prefills again once', async () => {
    const m = await mount();
    let ok = false;
    await act(async () => {
      ok = await m.vm.actions.rebuild('morning-brief');
    });
    expect(ok).toBe(true);
    expect(pond.rebuildAgentPrefill).toHaveBeenCalledTimes(1);
    expect(pond.rebuildAgentPrefill).toHaveBeenCalledWith('morning-brief');
    expect(pond.agentPrefills).toHaveBeenCalledTimes(2);
    expect(m.vm.notice).toBe("Morning brief will be rebuilt at your Pond's next quiet moment.");
    await m.unmount();
  });

  it('asks once for all of them', async () => {
    const m = await mount();
    await act(async () => {
      await m.vm.actions.rebuildAll();
    });
    expect(pond.rebuildAllPrefills).toHaveBeenCalledTimes(1);
    expect(pond.rebuildAgentPrefill).not.toHaveBeenCalled();
    expect(m.vm.notice).toBe("Every agent will be rebuilt at your Pond's next quiet moment.");
    await m.unmount();
  });

  it('says a refused rebuild in words, and nothing is left looking done', async () => {
    pond.rebuildAllPrefills.mockRejectedValue(new ApiError('POST → 503', 503, null));
    const m = await mount();
    let ok = true;
    await act(async () => {
      ok = await m.vm.actions.rebuildAll();
    });
    expect(ok).toBe(false);
    expect(m.vm.notice).toBeNull();
    expect(m.vm.error).toBe('Your Pond is busy. Try again in a moment.');
    expect(m.vm.rebuilding).toBeNull();
    await m.unmount();
  });
});

describe('suggestions', () => {
  const COPY: AgentRecipe = { id: 'r3', name: 'late-night-gate-alert', yaml: 'title: Late-night gate alert\ngiap_role:\n  instructions: Tell them.\n' };

  it('turns one on with one request, moving it from the offers to the agents', async () => {
    pond.enableAgentSuggestion.mockResolvedValue(COPY);
    const m = await mount();
    await act(async () => {
      await m.vm.actions.enableSuggestion(GATE.template);
    });
    expect(pond.enableAgentSuggestion).toHaveBeenCalledTimes(1);
    expect(pond.enableAgentSuggestion).toHaveBeenCalledWith(GATE.template);
    expect(m.vm.data.suggestions).toEqual([]);
    expect(m.vm.data.agents.map((a) => a.name)).toEqual(['late-night-gate-alert', 'morning-brief']);
    expect(m.vm.notice).toMatch(/^Late-night gate alert is on/);
    await m.unmount();
  });

  it('takes a 409 as already on: the card goes, and the list is read again', async () => {
    pond.enableAgentSuggestion.mockRejectedValue(new ApiError('POST → 409', 409, null));
    const m = await mount();
    // Turned on elsewhere, so the Pond no longer offers it.
    pond.listAgentSuggestions.mockResolvedValue([]);
    await act(async () => {
      await m.vm.actions.enableSuggestion(GATE.template);
    });
    expect(m.vm.data.suggestions).toEqual([]);
    expect(m.vm.notice).toBe('Late-night gate alert is already on. Find it with your agents.');
    expect(pond.listRecipes).toHaveBeenCalledTimes(2);
    await m.unmount();
  });

  it('keeps the card and says why when the Pond cannot run it', async () => {
    pond.enableAgentSuggestion.mockRejectedValue(new ApiError('POST → 422', 422, null, null, { missing: ['camera'] }));
    const m = await mount();
    await act(async () => {
      await m.vm.actions.enableSuggestion(GATE.template);
    });
    expect(m.vm.data.suggestions).toEqual([GATE]);
    expect(m.vm.suggestionErrors[GATE.template]).toBe('Your Pond cannot run this one yet.');
    await m.unmount();
  });

  it('hides a dismissed card at once, and puts it back when the Pond refuses', async () => {
    let refuse!: (e: unknown) => void;
    pond.dismissAgentSuggestion.mockReturnValue(new Promise((_, no) => (refuse = no)));
    const m = await mount();
    let pending!: Promise<void>;
    await act(async () => {
      pending = m.vm.actions.dismissSuggestion(GATE.template);
    });
    expect(m.vm.data.suggestions).toEqual([]);
    await act(async () => {
      refuse(new ApiError('POST → 500', 500, null));
      await pending;
    });
    expect(m.vm.data.suggestions).toEqual([GATE]);
    expect(m.vm.suggestionErrors[GATE.template]).toBe('Your Pond is busy. Try again in a moment.');
    await m.unmount();
  });
});

it('runs against the in-memory Pond on mock, sending nothing to the real one', async () => {
  server.real = false;
  const m = await mount();
  expect(m.vm.data.agents.length).toBeGreaterThan(0);
  expect(m.vm.data.builtIn.length).toBe(3);
  expect(pond.listRecipes).not.toHaveBeenCalled();
  expect(pond.agentPrefills).not.toHaveBeenCalled();
  await m.unmount();
});
