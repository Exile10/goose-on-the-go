// Teaching Goose a voice: a fresh run clears what came before, an accepted take moves on by itself,
// a refused one keeps the sentence and says why, and the fifth ends the run.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { VoicePrints, VoiceTakeResult } from '@/services/types';
import {
  describeTeachError,
  refusalWords,
  ROOM_PAUSE_RENEW_MS,
  ROOM_PAUSE_SECONDS,
  useTeachVoice,
  type UseTeachVoice,
} from '@/view-models/use-teach-voice';
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
    api: { voicePrints: jest.fn(), voiceTake: jest.fn(), resetWakeWordCalibration: jest.fn(), forgetVoicePrints: jest.fn(), retryVoicePrintModel: jest.fn(), pauseVoiceRoom: jest.fn(async () => undefined), resumeVoiceRoom: jest.fn(async () => undefined) },
  };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PRINTS: VoicePrints = {
  model: { state: 'ready', progress: null, credit: 'CC BY 4.0' },
  members: [{ profile_id: 'amina', name: 'Amina', takes: 5, needed: 5, enrolled: true, consistency: 0.8, updated_at: null }],
};

const accepted = (take: number, heard: number, fired = true): VoiceTakeResult => ({
  take_id: `take-${take}`,
  take,
  of: 5,
  wake: { heard: true, heard_as: 'hey goose', new_detector: fired },
  voice_match: { stored: true, enrolled: take >= 5, consistency: take >= 2 ? 0.8 : null },
  wake_detector: { kind: 'hey_goose', heard, of: take, reason: 'calibrated' },
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

it('says one missed sentence again in place of its take, and the done screen stays', async () => {
  const m = await mount();
  await act(async () => {
    await m.vm.actions.start();
  });
  for (const [take, heard, fired] of [
    [1, 1, true],
    [2, 1, false],
    [3, 2, true],
    [4, 3, true],
    [5, 3, false],
  ] as const) {
    pond.voiceTake.mockResolvedValueOnce(accepted(take, heard, fired));
    await act(async () => {
      await mockRecorder.handlers?.take('file:///n.wav');
    });
  }
  expect(m.vm.phase).toBe('done');
  expect(m.vm.detector?.heard).toBe(3);

  await act(async () => {
    await m.vm.actions.retake(1);
  });
  expect(m.vm.retaking).toBe(1);
  pond.voiceTake.mockResolvedValueOnce({ ...accepted(5, 4, true), take_id: 'take-2-again' });
  let outcome: string | undefined;
  await act(async () => {
    outcome = await mockRecorder.handlers?.take('file:///again.wav');
  });
  expect(pond.voiceTake).toHaveBeenLastCalledWith(expect.objectContaining({ replaces: 'take-2', prompt: m.vm.sentences[1] }));
  expect(outcome).toBe('done');
  expect(m.vm.phase).toBe('done');
  expect(m.vm.retaking).toBeNull();
  expect(m.vm.results.map((r) => r.detector)).toEqual([true, true, true, true, false]);
  expect(m.vm.results[1].takeId).toBe('take-2-again');
  expect(m.vm.detector?.heard).toBe(4);

  // A run that has ended cannot take a retake: it stops with words that say to teach all five again.
  expect(describeTeachError(new ApiError('x → 422', 422, null, null, { error: 'retake_not_found' }))).toBe(
    i18n.t('teachVoice.error.retakeTooLate'),
  );
  expect(refusalWords(new ApiError('x → 422', 422, null, null, { error: 'retake_not_found' }), 'hey goose')).toBeNull();

  // Cancelling goes back without sending anything.
  await act(async () => {
    await m.vm.actions.retake(4);
  });
  expect(m.vm.retaking).toBe(4);
  await act(async () => {
    m.vm.actions.cancelRetake();
  });
  expect(m.vm.retaking).toBeNull();
  expect(mockRecorder.stop).toHaveBeenCalled();
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

describe('asking the room not to listen while the sentences are read', () => {
  beforeEach(() => {
    // Only the renewal's interval is faked: mounting waits on a real timeout.
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'nextTick', 'setImmediate', 'queueMicrotask'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('pauses the room on Continue, renews it while the flow is open, and lets it listen once the run is done', async () => {
    const m = await mount();
    expect(pond.pauseVoiceRoom).not.toHaveBeenCalled();
    await act(async () => {
      await m.vm.actions.start();
    });
    expect(pond.pauseVoiceRoom).toHaveBeenCalledTimes(1);
    expect(pond.pauseVoiceRoom).toHaveBeenCalledWith(ROOM_PAUSE_SECONDS);

    act(() => {
      jest.advanceTimersByTime(ROOM_PAUSE_RENEW_MS);
    });
    expect(pond.pauseVoiceRoom).toHaveBeenCalledTimes(2);
    expect(pond.resumeVoiceRoom).not.toHaveBeenCalled();

    for (let take = 1; take <= 5; take += 1) {
      pond.voiceTake.mockResolvedValueOnce(accepted(take, take));
      await act(async () => {
        await mockRecorder.handlers?.take(`file:///${take}.wav`);
      });
    }
    expect(m.vm.phase).toBe('done');
    expect(pond.resumeVoiceRoom).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(ROOM_PAUSE_RENEW_MS * 2);
    });
    expect(pond.pauseVoiceRoom).toHaveBeenCalledTimes(2);
    await act(async () => {
      trees.splice(0).forEach((t) => t.unmount());
    });
    expect(pond.resumeVoiceRoom).toHaveBeenCalledTimes(1);
  });

  it('lets the room listen again when the flow is left part way, and never asks before Continue', async () => {
    await mount();
    await act(async () => {
      trees.splice(0).forEach((t) => t.unmount());
    });
    expect(pond.pauseVoiceRoom).not.toHaveBeenCalled();
    expect(pond.resumeVoiceRoom).not.toHaveBeenCalled();

    const m = await mount();
    await act(async () => {
      await m.vm.actions.start();
    });
    await act(async () => {
      trees.splice(0).forEach((t) => t.unmount());
    });
    expect(pond.resumeVoiceRoom).toHaveBeenCalledTimes(1);
  });

  it('carries on without asking again on a Pond that has no pause', async () => {
    pond.pauseVoiceRoom.mockRejectedValueOnce(new ApiError('x → 404', 404, null));
    const m = await mount();
    await act(async () => {
      await m.vm.actions.start();
    });
    expect(m.vm.phase).toBe('takes');
    act(() => {
      jest.advanceTimersByTime(ROOM_PAUSE_RENEW_MS * 2);
    });
    expect(pond.pauseVoiceRoom).toHaveBeenCalledTimes(1);
    await act(async () => {
      trees.splice(0).forEach((t) => t.unmount());
    });
    expect(pond.resumeVoiceRoom).not.toHaveBeenCalled();
  });
});
