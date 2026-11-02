// Voice Match's listing and forgetting, and what each refusal of a take says to do next.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { VoicePrints } from '@/services/types';
import { detectorHeardTake } from '@/view-models/use-wake-calibration';
import { describeTakeError, useVoicePrints, type UseVoicePrints } from '@/view-models/use-voice-prints';
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

it('says what to do about each refused take', () => {
  const said = (status: number, body: unknown = null) => describeTakeError(new ApiError(`x → ${status}`, status, null, null, body));
  expect(said(422, { error: 'no_speech' })).toBe(i18n.t('voiceMatch.error.noSpeech'));
  expect(said(409, { error: 'model_not_ready' })).toBe(i18n.t('voiceMatch.error.modelNotReady'));
  expect(said(404)).toBe(i18n.t('voiceMatch.error.unknownPerson'));
  expect(describeTakeError(new TypeError('network'))).toBe(i18n.t('voiceMatch.error.failed'));
});

it('reads a take as heard by the detector when its count went up with it', () => {
  expect(detectorHeardTake(null, undefined)).toBeNull();
  expect(detectorHeardTake(null, { kind: 'whisper', heard: 0, of: 1, reason: '' })).toBe(false);
  expect(detectorHeardTake(null, { kind: 'hey_goose', heard: 1, of: 1, reason: '' })).toBe(true);
  expect(detectorHeardTake({ kind: 'hey_goose', heard: 1, of: 1, reason: '' }, { kind: 'whisper', heard: 1, of: 2, reason: '' })).toBe(false);
  expect(detectorHeardTake({ kind: 'whisper', heard: 1, of: 2, reason: '' }, { kind: 'hey_goose', heard: 2, of: 3, reason: '' })).toBe(true);
});
