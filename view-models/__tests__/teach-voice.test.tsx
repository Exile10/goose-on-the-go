// Teaching Goose a voice: a fresh run clears what came before, an accepted take moves on by itself,
// a refused one keeps the sentence and says why, and the fifth ends the run.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { VoicePrints, VoiceTakeResult } from '@/services/types';
import { describeTeachError, refusalWords, useTeachVoice, type UseTeachVoice } from '@/view-models/use-teach-voice';
import type { TakeHandlers } from '@/view-models/use-take-recorder';
import { finishChecklistItem } from '@/view-models/use-setup-checklist';
import { resetMockVoice } from '@/view-models/voice-source';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect: run } = jest.requireActual('react');
    run(effect, [effect]);
  },
}));
const server = { hydrated: true, online: true, real: true, profileId: 'pairing-1', isScreenReal: () => server.real };
jest.mock('@/providers/server-provider', () => ({ useServer: () => server }));
const mockSettingsUpdate = jest.fn().mockResolvedValue(true);
jest.mock('../use-pond-settings', () => ({
  usePondSettings: () => ({ settings: { voice_wake_word: 'hey goose' }, actions: { update: mockSettingsUpdate } }),
}));
jest.mock('../use-setup-checklist', () => ({ finishChecklistItem: jest.fn() }));

// The microphone is the recorder's: here a take is handed straight to the flow's handler.
const mockRecorder = { handlers: null as TakeHandlers | null, start: jest.fn(), stop: jest.fn() };
jest.mock('../use-take-recorder', () => ({
  useTakeRecorder: (handlers: TakeHandlers) => {
    mockRecorder.handlers = handlers;
    return { state: 'listening', level: 0, error: null, supported: true, start: mockRecorder.start, stop: mockRecorder.stop };
  },
}));

jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: { voicePrints: jest.fn(), voiceTake: jest.fn(), resetWakeWordCalibration: jest.fn(), forgetVoicePrints: jest.fn(), retryVoicePrintModel: jest.fn() },
  };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PRINTS: VoicePrints = {
  model: { state: 'ready', progress: null, credit: 'CC BY 4.0' },
  members: [{ profile_id: 'amina', name: 'Amina', takes: 5, needed: 5, enrolled: true, consistency: 0.8, updated_at: null }],
};

const accepted = (take: number, heard: number, fired = true): VoiceTakeResult => ({
  take,
  of: 5,
  wake: { heard: true, heard_as: 'hey goose', new_detector: fired },
  voice_match: { stored: true, enrolled: take >= 5, consistency: take >= 2 ? 0.8 : null },
  wake_detector: { kind: 'hey_goose', heard, of: take, reason: '' },
});

const trees: ReactTestRenderer[] = [];

async function mount(
  member: { id: string; name: string } | null = { id: 'amina', name: 'Amina' },
  phrase = 'hey goose',
): Promise<{ readonly vm: UseTeachVoice }> {
  let latest!: UseTeachVoice;
  const Probe = () => {
    latest = useTeachVoice({ member, phrase });
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
  resetMockVoice();
  pond.voicePrints.mockResolvedValue(PRINTS);
  // Starting runs the flow's own first steps, as the real mockRecorder does before it listens.
  mockRecorder.start.mockImplementation(async (prepare?: () => Promise<void>) => {
    await prepare?.();
  });
});

afterEach(async () => {
  await act(async () => {
    trees.splice(0).forEach((t) => t.unmount());
  });
});

it('keeps what the Pond learned about the phrase, and forgets a print it is recording again', async () => {
  const m = await mount();
  expect(m.vm.phase).toBe('intro');
  expect(m.vm.voiceMatch.on).toBe(true);
  await act(async () => {
    await m.vm.actions.start();
  });
  expect(pond.resetWakeWordCalibration).not.toHaveBeenCalled();
  expect(pond.forgetVoicePrints).toHaveBeenCalledWith('amina');
  expect(mockSettingsUpdate).not.toHaveBeenCalled();
  expect(m.vm.phase).toBe('takes');
  expect(m.vm.sentences[m.vm.index]).toMatch(/^Hey goose, /);
});

it('moves on by itself, keeps the sentence when one is refused, and ends after the fifth', async () => {
  const m = await mount();
  await act(async () => {
    await m.vm.actions.start();
  });
  pond.voiceTake.mockResolvedValueOnce(accepted(1, 1));
  let outcome: string | undefined;
  await act(async () => {
    outcome = await mockRecorder.handlers?.take('file:///1.wav');
  });
  expect(outcome).toBe('again');
  expect(m.vm.index).toBe(1);
  expect(pond.voiceTake).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'amina', voiceMatch: true, prompt: m.vm.sentences[0] }));

  pond.voiceTake.mockRejectedValueOnce(new ApiError('x → 422', 422, null, null, { error: 'no_wake_phrase', heard_as: 'hey ghost' }));
  await act(async () => {
    outcome = await mockRecorder.handlers?.take('file:///2.wav');
  });
  expect(outcome).toBe('again');
  expect(m.vm.index).toBe(1);
  expect(m.vm.said).toContain('hey ghost');

  for (const [take, heard, fired] of [
    [2, 2, true],
    [3, 2, false],
    [4, 3, true],
  ] as const) {
    pond.voiceTake.mockResolvedValueOnce(accepted(take, heard, fired));
    await act(async () => {
      await mockRecorder.handlers?.take('file:///n.wav');
    });
  }
  expect(m.vm.said).toBeNull();
  pond.voiceTake.mockResolvedValueOnce(accepted(5, 4));
  await act(async () => {
    outcome = await mockRecorder.handlers?.take('file:///5.wav');
  });
  expect(outcome).toBe('done');
  expect(m.vm.phase).toBe('done');
  expect(m.vm.results.map((r) => r.detector)).toEqual([true, true, false, true, true]);
  expect(m.vm.enrolled).toBe(true);
  expect(finishChecklistItem).toHaveBeenCalledWith('pairing-1', 'wake');
});

it('clears what the Pond learned about the phrase only when it saves a new phrase', async () => {
  const m = await mount(undefined, 'jambo bata');
  await act(async () => {
    await m.vm.actions.start();
  });
  expect(pond.resetWakeWordCalibration).toHaveBeenCalledTimes(1);
  expect(mockSettingsUpdate).toHaveBeenCalledWith('voice_wake_word', 'jambo bata');
  expect(pond.resetWakeWordCalibration.mock.invocationCallOrder[0]).toBeLessThan(mockSettingsUpdate.mock.invocationCallOrder[0]);
});

it('teaches only the wake phrase for a phone that belongs to no one', async () => {
  const m = await mount(null);
  expect(m.vm.voiceMatch).toMatchObject({ on: false, available: false });
  await act(async () => {
    await m.vm.actions.start();
  });
  expect(pond.forgetVoicePrints).not.toHaveBeenCalled();
  pond.voiceTake.mockResolvedValueOnce({ ...accepted(1, 0), voice_match: null });
  await act(async () => {
    await mockRecorder.handlers?.take('file:///1.wav');
  });
  expect(pond.voiceTake).toHaveBeenCalledWith(expect.objectContaining({ profileId: null, voiceMatch: false }));
});

it('says each refusal in plain words, and ends the run on anything else', () => {
  const refusal = (status: number, body: unknown) => new ApiError(`x → ${status}`, status, null, null, body);
  expect(refusalWords(refusal(422, { error: 'no_speech' }), 'hey goose')).toBe(i18n.t('teachVoice.refused.noSpeech'));
  expect(refusalWords(refusal(422, { error: 'no_wake_phrase', heard_as: 'hey ghost' }), 'hey goose')).toBe(
    i18n.t('teachVoice.refused.heardAs', { heardAs: 'hey ghost', phrase: 'Hey goose' }),
  );
  expect(refusalWords(refusal(409, { error: 'model_not_ready' }), 'hey goose')).toBeNull();
  expect(describeTeachError(refusal(409, { error: 'model_not_ready' }))).toBe(i18n.t('teachVoice.error.modelNotReady'));
  expect(describeTeachError(new TypeError('network'))).toBe(i18n.t('teachVoice.error.failed'));
});
