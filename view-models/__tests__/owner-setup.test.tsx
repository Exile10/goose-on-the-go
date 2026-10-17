/**
 * Owner setup against a Pond that refuses most reads until it is done. Pinned: the owner is made
 * once however many steps write to them, the record is read without writing, a part-done
 * setup reopens on the right step, and a refused finish sends the household where the gap is.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ApiError, api } from '@/services/api-client';
import type { OnboardStatus, PondSettings } from '@/services/types';
import { useOwnerSetup, type UseOwnerSetup } from '@/view-models/use-owner-setup';
import { resetSetupGate } from '@/view-models/use-setup-gate';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      onboardStatus: jest.fn(),
      recordOnboardStep: jest.fn(),
      completeOnboarding: jest.fn(),
      updateSettings: jest.fn(),
      getSettings: jest.fn(),
      createProfile: jest.fn(),
      setProfilePrefs: jest.fn(),
      systemInfo: jest.fn(),
      detectLocation: jest.fn(),
    },
  };
});
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: true, paired: true, profileId: 'pairing-1' }),
}));

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const status = (current_step: string, onboarded = false): OnboardStatus => ({ onboarded, current_step, steps_completed: 0, total_steps: 10 });
const record = (change: Partial<PondSettings> = {}) =>
  ({ user_name: 'Friend', assistant_name: 'Goose', timezone: 'UTC', primary_profile_id: null, ...change }) as PondSettings;

async function mount() {
  let latest!: UseOwnerSetup;
  const Probe = () => {
    latest = useOwnerSetup();
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
    unmount: () => act(() => tree.unmount()),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetSetupGate();
  await AsyncStorage.clear();
  pond.updateSettings.mockResolvedValue(record());
  pond.getSettings.mockResolvedValue(record());
  pond.recordOnboardStep.mockResolvedValue(status('Basics'));
  pond.systemInfo.mockResolvedValue({ hostname: 'nano', version: '0.9.0' });
  pond.createProfile.mockResolvedValue({ id: 'owner-1', display_name: 'Amina', avatar_emoji: '' });
  pond.setProfilePrefs.mockResolvedValue({ id: 'owner-1', display_name: 'Amina', preferences: {} });
});

it('reads the record with GET, and writes nothing to read it', async () => {
  pond.onboardStatus.mockResolvedValue(status('not_started'));
  pond.getSettings.mockResolvedValue(record());
  const m = await mount();
  expect(m.vm.phase).toBe('wizard');
  expect(m.vm.step).toBe('welcome');
  expect(pond.getSettings).toHaveBeenCalledTimes(1);
  expect(pond.updateSettings).not.toHaveBeenCalled();
  m.unmount();
});

it('reads it with an empty PUT from a Pond that refuses GET until setup is done', async () => {
  pond.onboardStatus.mockResolvedValue(status('not_started'));
  pond.getSettings.mockRejectedValue(new ApiError('GET /api/v1/settings → 403', 403, null, 'onboarding_required'));
  const m = await mount();
  expect(m.vm.phase).toBe('wizard');
  expect(pond.updateSettings).toHaveBeenCalledTimes(1);
  expect(pond.updateSettings).toHaveBeenCalledWith({});
  m.unmount();
});

it('does not write to read when the Pond simply cannot be reached', async () => {
  pond.onboardStatus.mockResolvedValue(status('not_started'));
  pond.getSettings.mockRejectedValue(new Error('Network request failed'));
  const m = await mount();
  expect(m.vm.phase).toBe('wizard');
  expect(pond.updateSettings).not.toHaveBeenCalled();
  m.unmount();
});

it('reopens on the step after the one the Pond last recorded', async () => {
  pond.onboardStatus.mockResolvedValue(status('Basics'));
  pond.getSettings.mockResolvedValue(record({ user_name: 'Amina' }));
  const m = await mount();
  expect(m.vm.step).toBe('locale');
  expect(m.vm.draft.userName).toBe('Amina');
  m.unmount();
});

it('makes the owner once, and sends their whole preference map from each step that writes it', async () => {
  pond.onboardStatus.mockResolvedValue(status('Welcome'));
  const m = await mount();
  expect(m.vm.step).toBe('about-you');

  await act(async () => m.vm.actions.patch({ userName: 'Amina', slowSpeech: true }));
  await act(async () => m.vm.actions.next());
  expect(m.vm.step).toBe('locale');

  await act(async () => m.vm.actions.patch({ language: 'sw' }));
  await act(async () => m.vm.actions.next());
  expect(m.vm.step).toBe('personality');

  expect(pond.createProfile).toHaveBeenCalledTimes(1);
  expect(pond.createProfile).toHaveBeenCalledWith('Amina');
  expect(pond.updateSettings).toHaveBeenCalledWith({ primary_profile_id: 'owner-1' });
  expect(pond.setProfilePrefs).toHaveBeenCalledTimes(2);
  expect(pond.setProfilePrefs).toHaveBeenLastCalledWith('owner-1', {
    language: 'sw',
    accessibility_atypical_speech: 'false',
    accessibility_slow_speech: 'true',
  });
  expect(pond.recordOnboardStep.mock.calls.map(([step]) => step)).toEqual(['Basics', 'Location']);
  m.unmount();
});

it('uses the owner the Pond already has rather than making a second', async () => {
  pond.onboardStatus.mockResolvedValue(status('Welcome'));
  pond.getSettings.mockResolvedValue(record({ primary_profile_id: 'owner-0' }));
  const m = await mount();
  await act(async () => m.vm.actions.patch({ userName: 'Amina' }));
  await act(async () => m.vm.actions.next());
  expect(pond.createProfile).not.toHaveBeenCalled();
  expect(pond.setProfilePrefs).toHaveBeenCalledWith('owner-0', expect.any(Object));
  m.unmount();
});

it('does not overwrite preferences it cannot see, resuming past About you with nothing kept', async () => {
  pond.onboardStatus.mockResolvedValue(status('Basics'));
  const m = await mount();
  expect(m.vm.step).toBe('locale');
  await act(async () => m.vm.actions.next());
  expect(pond.setProfilePrefs).not.toHaveBeenCalled();
  m.unmount();
});

it('takes the household back to the step that sets a field the Pond is missing', async () => {
  pond.onboardStatus.mockResolvedValue(status('WakeWord'));
  pond.completeOnboarding.mockResolvedValue({ completed: false, missing: ['timezone', 'chat_model'] });
  const m = await mount();
  expect(m.vm.step).toBe('complete');
  await act(async () => m.vm.actions.finish());
  expect(m.vm.step).toBe('locale');
  expect(m.vm.notice).toBeTruthy();
  expect(m.vm.noChatModel).toBe(true);
  m.unmount();
});

it('stays to say so when only the chat model is missing, since no step sets it', async () => {
  pond.onboardStatus.mockResolvedValue(status('WakeWord'));
  pond.completeOnboarding.mockResolvedValue({ completed: false, missing: ['chat_model'] });
  const m = await mount();
  await act(async () => m.vm.actions.finish());
  expect(m.vm.step).toBe('complete');
  expect(m.vm.noChatModel).toBe(true);
  expect(m.vm.phase).toBe('wizard');
  m.unmount();
});

it('finishes, and says so to the gate', async () => {
  pond.onboardStatus.mockResolvedValue(status('WakeWord'));
  pond.completeOnboarding.mockResolvedValue({ completed: true });
  const m = await mount();
  await act(async () => m.vm.actions.finish());
  expect(m.vm.phase).toBe('finished');
  expect(pond.updateSettings).toHaveBeenCalledWith({ agent_memory_inject: true });
  expect(pond.recordOnboardStep).toHaveBeenLastCalledWith('Extensions');
  m.unmount();
});

it('leaves a Pond that is already set up for Home', async () => {
  pond.onboardStatus.mockResolvedValue(status('Completed', true));
  const m = await mount();
  expect(m.vm.phase).toBe('alreadyDone');
  expect(pond.updateSettings).not.toHaveBeenCalled();
  m.unmount();
});
