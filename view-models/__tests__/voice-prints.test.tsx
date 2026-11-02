// Voice Match's listing and forgetting.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import type { VoicePrints } from '@/services/types';
import { useVoicePrints, type UseVoicePrints } from '@/view-models/use-voice-prints';
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
    api: { voicePrints: jest.fn(), forgetVoicePrints: jest.fn(), retryVoicePrintModel: jest.fn(), agentPrefills: jest.fn() },
  };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PRINTS: VoicePrints = {
  model: { state: 'ready', progress: null, credit: 'WeSpeaker ResNet34, VoxCeleb. CC BY 4.0.' },
  members: [
    { profile_id: 'z', name: 'Zawadi', takes: 0, needed: 5, enrolled: false, consistency: null, updated_at: null },
    { profile_id: 'a', name: 'Amina', takes: 5, needed: 5, enrolled: true, consistency: 0.8, updated_at: '2026-11-01T10:00:00Z' },
  ],
};

const trees: ReactTestRenderer[] = [];

async function mount(): Promise<{ readonly vm: UseVoicePrints }> {
  let latest!: UseVoicePrints;
  const Probe = () => {
    latest = useVoicePrints();
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
  pond.voicePrints.mockResolvedValue(PRINTS);
});

afterEach(async () => {
  await act(async () => {
    trees.splice(0).forEach((t) => t.unmount());
  });
});

it('lists known voices first and counts them', async () => {
  const m = await mount();
  expect(m.vm.data.members.map((p) => p.name)).toEqual(['Amina', 'Zawadi']);
  expect(m.vm.data.known).toBe(1);
  expect(m.vm.data.model?.credit).toContain('CC BY 4.0');
});

it('forgets a voice and reads the listing again', async () => {
  pond.forgetVoicePrints.mockResolvedValueOnce(undefined);
  const m = await mount();
  let refused: string | null = 'unset';
  await act(async () => {
    refused = await m.vm.actions.forget(PRINTS.members[1]);
  });
  expect(refused).toBeNull();
  expect(pond.forgetVoicePrints).toHaveBeenCalledWith('a');
  expect(pond.voicePrints).toHaveBeenCalledTimes(2);
});

it('shows a Pond without Voice Match as one that needs an update', async () => {
  pond.voicePrints.mockRejectedValue(new ApiError('x → 404', 404, null));
  const m = await mount();
  expect(m.vm.missing).toBe(true);
  expect(m.vm.failed).toBe(false);
});
