// The room's status is one read per tick, its stream is opened only where asked for, and a Pond
// without the routes is told apart from one that failed.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import type { RoomVoiceEvent, VoiceRoom } from '@/services/types';
import { openRoomStream, useVoiceRoom, type UseVoiceRoom } from '@/view-models/use-voice-room';
import { POND_VOICE, resetMockVoice } from '@/view-models/voice-source';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect: run } = jest.requireActual('react');
    run(effect, [effect]);
  },
}));
jest.mock('../use-screen-active', () => ({ useScreenActive: () => true }));
const server = { hydrated: true, online: true, real: true, isScreenReal: () => server.real };
jest.mock('@/providers/server-provider', () => ({ useServer: () => server }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      voiceRoom: jest.fn(),
      setVoiceRoom: jest.fn(),
      interruptVoiceRoom: jest.fn(),
      streamVoiceRoom: jest.fn(),
      agentPrefills: jest.fn(),
      rebuildAgentPrefill: jest.fn(),
    },
  };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOM: VoiceRoom = {
  enabled: true,
  available: true,
  unavailable_reason: null,
  state: 'wait',
  wake: { phrase: 'hey goose', detector: 'whisper', reason: 'not_calibrated' },
  interrupts: 'wake_only',
  last_heard: null,
  session_id: 's1',
  paused_until: null,
};

const trees: ReactTestRenderer[] = [];

async function mount(stream = false): Promise<{ readonly vm: UseVoiceRoom }> {
  let latest!: UseVoiceRoom;
  const Probe = () => {
    latest = useVoiceRoom({ stream });
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
  pond.voiceRoom.mockResolvedValue(ROOM);
  pond.streamVoiceRoom.mockImplementation(() => new Promise(() => {}));
});

afterEach(async () => {
  await act(async () => {
    trees.splice(0).forEach((t) => t.unmount());
  });
});

it('reads the status once, and opens no stream unless asked to', async () => {
  const m = await mount();
  expect(m.vm.room).toEqual(ROOM);
  expect(m.vm.live.state).toBe('wait');
  expect(pond.voiceRoom).toHaveBeenCalledTimes(1);
  expect(pond.streamVoiceRoom).not.toHaveBeenCalled();
});

it('folds the stream into what it shows, and names who woke it', async () => {
  let send!: (e: RoomVoiceEvent) => void;
  pond.streamVoiceRoom.mockImplementation((onEvent, _signal, onOpen) => {
    send = onEvent;
    onOpen?.();
    return new Promise(() => {});
  });
  const m = await mount(true);
  expect(m.vm.streaming).toBe(true);
  await act(async () => {
    send({ event: 'wake', who: { profile_id: 'p1', name: 'Amina' } });
    send({ event: 'state', state: 'speak' });
    send({ event: 'token', content: 'Hello.' });
  });
  expect(m.vm.live).toMatchObject({ state: 'speak', reply: 'Hello.', woke: { name: 'Amina' } });
  expect(m.vm.room?.last_heard?.name).toBe('Amina');
});

it('tells a Pond without room voice apart from one that failed', async () => {
  pond.voiceRoom.mockRejectedValue(new ApiError('x → 404', 404, null));
  const m = await mount();
  expect(m.vm.missing).toBe(true);
  expect(m.vm.failed).toBe(false);

  pond.voiceRoom.mockRejectedValue(new ApiError('x → 500', 500, null));
  const n = await mount();
  expect(n.vm.missing).toBe(false);
  expect(n.vm.failed).toBe(true);
});

it('switches the room off with one request, and says why when the Pond refuses', async () => {
  pond.setVoiceRoom.mockResolvedValueOnce({ ...ROOM, enabled: false, state: 'off' });
  const m = await mount();
  let refused: string | null = 'unset';
  await act(async () => {
    refused = await m.vm.actions.setEnabled(false);
  });
  expect(refused).toBeNull();
  expect(pond.setVoiceRoom).toHaveBeenCalledWith(false);
  expect(m.vm.room?.enabled).toBe(false);
  expect(m.vm.live.state).toBe('off');

  pond.setVoiceRoom.mockRejectedValueOnce(new ApiError('x → 500', 500, null));
  await act(async () => {
    refused = await m.vm.actions.setEnabled(true);
  });
  expect(refused).toEqual(expect.any(String));
});

it('treats an interrupt that found nothing speaking as done', async () => {
  pond.interruptVoiceRoom.mockRejectedValueOnce(new ApiError('x → 409', 409, null));
  const m = await mount();
  await act(async () => {
    await m.vm.actions.interrupt();
  });
  expect(m.vm.error).toBeNull();
});

it('runs against the mock Pond on mock, sending nothing to the real one', async () => {
  server.real = false;
  const m = await mount();
  expect(m.vm.room?.available).toBe(true);
  expect(pond.voiceRoom).not.toHaveBeenCalled();
});

describe('keeping the stream open', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('opens again after a drop, and never again on a Pond without the route', async () => {
    const live = jest.fn();
    pond.streamVoiceRoom.mockImplementationOnce(async (_e, _s, onOpen) => {
      onOpen?.();
    });
    pond.streamVoiceRoom.mockRejectedValueOnce(new ApiError('x → 404', 404, null));
    const stop = openRoomStream(POND_VOICE, { onEvent: () => {}, onLive: live }, 1_000);
    await act(async () => {
      await Promise.resolve();
    });
    expect(live).toHaveBeenNthCalledWith(1, true);
    expect(live).toHaveBeenNthCalledWith(2, false);
    await act(async () => {
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    expect(pond.streamVoiceRoom).toHaveBeenCalledTimes(2);
    await act(async () => {
      jest.advanceTimersByTime(120_000);
      await Promise.resolve();
    });
    expect(pond.streamVoiceRoom).toHaveBeenCalledTimes(2);
    stop();
  });
});
