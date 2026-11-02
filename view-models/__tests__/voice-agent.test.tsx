// The Voice agent's form: edits stay on the phone until saved, a save sends only what changed, and a
// refusal lands under the field it names, or says a guest cannot change it.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import type { VoiceAgent } from '@/services/types';
import { resetMockAgents } from '@/view-models/agents-source';
import { useVoiceAgent, type UseVoiceAgent } from '@/view-models/use-voice-agent';
import { resetMockVoice } from '@/view-models/voice-source';

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
      voiceAgent: jest.fn(),
      updateVoiceAgent: jest.fn(),
      resetVoiceAgent: jest.fn(),
      rebuildAgentPrefill: jest.fn(),
      agentPrefills: jest.fn(),
    },
  };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AGENT: VoiceAgent = {
  name: 'voice',
  title: 'Voice',
  edited: false,
  instructions: 'Answer out loud.',
  shipped_instructions: 'Answer out loud.',
  examples: [{ brief: 'Weather?', answer: 'Sunny.' }],
  tool_groups: [
    { group: 'giap-weather', label: 'Weather', on: true },
    { group: 'giap-knowledge', label: 'Web search', on: true },
  ],
  max_turns: 4,
  shipped_max_turns: 0,
  prefill: { agent: 'voice', kind: 'default', status: 'ready', compiled_at: null, last_used_at: null },
};

const trees: ReactTestRenderer[] = [];

async function mount(): Promise<{ readonly vm: UseVoiceAgent }> {
  let latest!: UseVoiceAgent;
  const Probe = () => {
    latest = useVoiceAgent();
    return null;
  };
  await act(async () => {
    trees.push(create(<Probe />));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return {
    get vm() {
      return latest;
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  server.real = true;
  resetMockVoice();
  resetMockAgents();
  pond.voiceAgent.mockResolvedValue(AGENT);
});

afterEach(async () => {
  await act(async () => {
    trees.splice(0).forEach((t) => t.unmount());
  });
});

it('saves only what changed, then shows what the Pond holds', async () => {
  pond.updateVoiceAgent.mockResolvedValueOnce({ ...AGENT, edited: true, tool_groups: [AGENT.tool_groups[0], { ...AGENT.tool_groups[1], on: false }] });
  const m = await mount();
  expect(m.vm.changed).toBe(false);
  act(() => m.vm.actions.setGroup('giap-knowledge', false));
  expect(m.vm.changed).toBe(true);
  let saved = false;
  await act(async () => {
    saved = await m.vm.actions.save();
  });
  expect(saved).toBe(true);
  expect(pond.updateVoiceAgent).toHaveBeenCalledWith({ tool_groups_off: ['giap-knowledge'] });
  expect(m.vm.agent?.edited).toBe(true);
  expect(m.vm.changed).toBe(false);
  expect(m.vm.notice).toEqual(expect.any(String));
});

it('keeps an edit in progress when the agent is read again', async () => {
  const m = await mount();
  act(() => m.vm.actions.setInstructions('Be brief.'));
  await act(async () => {
    await m.vm.actions.refresh();
  });
  expect(m.vm.draft?.instructions).toBe('Be brief.');
  act(() => m.vm.actions.revert());
  expect(m.vm.draft?.instructions).toBe('Answer out loud.');
});

it('puts each refusal under the field its path names', async () => {
  pond.updateVoiceAgent.mockRejectedValueOnce(
    new ApiError('x → 422', 422, null, null, {
      errors: [
        { path: 'examples[0].answer', message: 'is empty' },
        { path: 'colour', message: 'is not a field of the Voice agent' },
      ],
    }),
  );
  const m = await mount();
  act(() => m.vm.actions.setExample(0, { brief: 'Weather?', answer: '' }));
  await act(async () => {
    await m.vm.actions.save();
  });
  expect(m.vm.fieldErrors.examples).toBe('is empty');
  expect(m.vm.otherErrors).toEqual([{ path: 'colour', message: 'is not a field of the Voice agent' }]);
  expect(m.vm.draft?.examples[0]).toEqual({ brief: 'Weather?', answer: '' });
});

it('tells a guest it cannot change the agent', async () => {
  pond.updateVoiceAgent.mockRejectedValueOnce(new ApiError('x → 403', 403, null));
  const m = await mount();
  act(() => m.vm.actions.setMaxTurns(2));
  await act(async () => {
    await m.vm.actions.save();
  });
  expect(m.vm.error).toMatch(/guest/);
});

it('goes back to the shipped agent', async () => {
  pond.voiceAgent.mockResolvedValue({ ...AGENT, edited: true, instructions: 'Mine.' });
  pond.resetVoiceAgent.mockResolvedValueOnce(AGENT);
  const m = await mount();
  expect(m.vm.draft?.instructions).toBe('Mine.');
  await act(async () => {
    await m.vm.actions.reset();
  });
  expect(m.vm.agent?.edited).toBe(false);
  expect(m.vm.draft?.instructions).toBe('Answer out loud.');
});

it('says when the Pond has no Voice agent, rather than that it failed', async () => {
  pond.voiceAgent.mockRejectedValue(new ApiError('x → 404', 404, null));
  const m = await mount();
  expect(m.vm.missing).toBe(true);
  expect(m.vm.failed).toBe(false);
});

it('asks the agents routes to rebuild its copy', async () => {
  pond.rebuildAgentPrefill.mockResolvedValueOnce(undefined);
  const m = await mount();
  await act(async () => {
    await m.vm.actions.rebuild();
  });
  expect(pond.rebuildAgentPrefill).toHaveBeenCalledWith('voice');
});

it('edits the mock Pond on mock, and its copy shows on the agents mock', async () => {
  server.real = false;
  const m = await mount();
  expect(m.vm.agent?.prefill.agent).toBe('voice');
  act(() => m.vm.actions.setInstructions('Talk like a radio host.'));
  await act(async () => {
    await m.vm.actions.save();
  });
  expect(m.vm.agent?.edited).toBe(true);
  expect(m.vm.agent?.prefill.status).toBe('queued');
  expect(pond.updateVoiceAgent).not.toHaveBeenCalled();
});
