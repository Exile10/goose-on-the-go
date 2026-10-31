/**
 * Switching a device: the tap waits for the Pond, and the device's state changes
 * only to what the Pond read back from it. A tap the Pond could not be reached
 * for waits, on a Pond that can take it again safely, and goes when it is back.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { Device, DeviceEvent } from '@/services/types';
import { useDevices, type UseDevices } from '@/view-models/use-devices';

jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      listDevices: jest.fn(),
      getDeviceState: jest.fn(),
      setDeviceState: jest.fn(),
      matterStatus: jest.fn(),
      streamDeviceEvents: jest.fn(),
    },
  };
});

jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: true }),
}));

// Off unless a test is about the event stream, which is only open while the screen is in front.
const screen = { active: false };
jest.mock('../use-screen-active', () => ({ useScreenActive: () => screen.active }));

let poll: (() => Promise<unknown>) | null = null;
jest.mock('../use-live', () => ({
  useLive: (read: () => Promise<unknown>, _delay: unknown, enabled = true) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    poll = read;
    useEffect(() => {
      if (enabled) void read();
    }, [enabled]);
  },
}));

const pond = jest.mocked(api);

const HEATER: Device = { id: 'heater', name: 'Water heater', is_online: true, capabilities: ['power'] };

const power = (on: boolean) => ({ content: `power: ${on ? 'on' : 'off'}`, success: true });
const offline = () => new TypeError('Network request failed');

/** A Pond that honours keys: it echoes each command's key. */
function honoursKeys() {
  pond.setDeviceState.mockImplementation(async (_id, patch, key) => ({ ...power(!!patch.power), idempotency_key: key }));
}

async function tick() {
  await act(async () => {
    await poll?.();
  });
}

async function mount(): Promise<{ readonly vm: UseDevices }> {
  let latest!: UseDevices;
  const Probe = () => {
    latest = useDevices();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  mounted.push(tree);
  return {
    get vm() {
      return latest;
    },
  };
}

const mounted: ReactTestRenderer[] = [];

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.resetAllMocks();
  screen.active = false;
  pond.listDevices.mockResolvedValue([HEATER]);
  pond.getDeviceState.mockResolvedValue(power(true));
  pond.matterStatus.mockRejectedValue(new Error('not needed'));
});

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});

describe('switching a device', () => {
  it('shows the tap as waiting, and the device as on until the Pond says otherwise', async () => {
    const m = await mount();
    expect(m.vm.data.powerById.heater).toBe(true);

    let confirm!: () => void;
    pond.setDeviceState.mockReturnValue(new Promise((resolve) => (confirm = () => resolve(power(false)))));
    pond.getDeviceState.mockResolvedValue(power(false));

    let switching!: Promise<void>;
    act(() => {
      switching = m.vm.actions.setState(HEATER, { power: false });
    });
    expect(m.vm.data.waitingById.heater).toBe(false);
    expect(m.vm.data.powerById.heater).toBe(true);

    await act(async () => {
      confirm();
      await switching;
    });
    expect(m.vm.data.waitingById.heater).toBeUndefined();
    expect(m.vm.data.powerById.heater).toBe(false);
  });

  it('leaves the device as it was when the Pond refuses, and stops waiting', async () => {
    const m = await mount();
    pond.setDeviceState.mockRejectedValue(new Error('unreachable'));

    await act(async () => {
      await m.vm.actions.setState(HEATER, { power: false });
    });
    expect(m.vm.data.waitingById.heater).toBeUndefined();
    expect(m.vm.data.powerById.heater).toBe(true);
  });

  it('shows what the device did, not what was asked', async () => {
    const m = await mount();
    pond.setDeviceState.mockResolvedValue(power(true));
    pond.getDeviceState.mockResolvedValue(power(true));

    await act(async () => {
      await m.vm.actions.setState(HEATER, { power: false });
    });
    expect(m.vm.data.powerById.heater).toBe(true);
  });
});

describe('a tap while the Pond is out of reach', () => {
  /** Mounts, and has the Pond echo one command's key, so the phone knows it can send one again. */
  async function mountKnowingKeys() {
    honoursKeys();
    const m = await mount();
    await act(async () => {
      await m.vm.actions.setState(HEATER, { power: true });
    });
    return m;
  }

  it('waits, and goes with the same key once the Pond answers again', async () => {
    const m = await mountKnowingKeys();
    pond.setDeviceState.mockRejectedValueOnce(offline());
    await act(async () => {
      await m.vm.actions.setState(HEATER, { power: false });
    });
    expect(m.vm.data.queued).toHaveLength(1);
    expect(m.vm.data.waitingById.heater).toBe(false);
    expect(m.vm.data.powerById.heater).toBe(true);
    const key = m.vm.data.queued[0].key;

    pond.getDeviceState.mockResolvedValue(power(false));
    await tick();
    expect(pond.setDeviceState).toHaveBeenLastCalledWith('heater', { power: false }, key);
    expect(m.vm.data.queued).toHaveLength(0);
    expect(m.vm.data.waitingById.heater).toBeUndefined();
    expect(m.vm.data.powerById.heater).toBe(false);
  });

  it('is not kept on a Pond that does not know keys, since sending it again could run it twice', async () => {
    const m = await mount();
    pond.setDeviceState.mockRejectedValue(offline());
    await act(async () => {
      await m.vm.actions.setState(HEATER, { power: false });
    });
    expect(m.vm.data.queued).toHaveLength(0);
    expect(m.vm.data.waitingById.heater).toBeUndefined();
  });

  it('is not kept when the Pond refuses it', async () => {
    const m = await mountKnowingKeys();
    pond.setDeviceState.mockRejectedValueOnce(new ApiError('x', 409, null));
    await act(async () => {
      await m.vm.actions.setState(HEATER, { power: false });
    });
    expect(m.vm.data.queued).toHaveLength(0);
  });

  it('can be taken back before it goes', async () => {
    const m = await mountKnowingKeys();
    pond.setDeviceState.mockRejectedValueOnce(offline());
    await act(async () => {
      await m.vm.actions.setState(HEATER, { power: false });
    });
    act(() => m.vm.actions.cancel('heater'));
    expect(m.vm.data.queued).toHaveLength(0);
    expect(m.vm.data.waitingById.heater).toBeUndefined();

    const sent = pond.setDeviceState.mock.calls.length;
    await tick();
    expect(pond.setDeviceState).toHaveBeenCalledTimes(sent);
  });

  it('is dropped, and the person told, once it has waited too long', async () => {
    const m = await mountKnowingKeys();
    pond.setDeviceState.mockRejectedValueOnce(offline());
    await act(async () => {
      await m.vm.actions.setState(HEATER, { power: false });
    });

    const later = Date.now() + 11 * 60_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(later);
    pond.listDevices.mockRejectedValue(offline());
    try {
      await tick();
    } finally {
      now.mockRestore();
    }
    expect(m.vm.data.queued).toHaveLength(0);
    expect(m.vm.data.waitingById.heater).toBeUndefined();
    expect(m.vm.error).toBe(i18n.t('devices.commandsExpired', { count: 1, minutes: 10 }));
  });
});

describe('the device event stream', () => {
  /** Opens the stream and hands back a way to send events down it, and to end it. */
  function streamOpens() {
    let emit!: (event: DeviceEvent) => void;
    let end!: (error?: unknown) => void;
    pond.streamDeviceEvents.mockImplementation((onEvent, _signal, onOpen) => {
      emit = onEvent;
      onOpen?.();
      return new Promise<void>((resolve, reject) => (end = (e) => (e ? reject(e) : resolve())));
    });
    return {
      emit: (event: DeviceEvent) => act(() => emit(event)),
      end: (e?: unknown) => act(async () => end(e)),
    };
  }

  beforeEach(() => {
    screen.active = true;
  });

  it('shows a device turned off elsewhere without reading every device again', async () => {
    const stream = streamOpens();
    const m = await mount();
    const reads = pond.getDeviceState.mock.calls.length;

    stream.emit({ type: 'device_state', seq: 7, device_id: 'heater', key: 'power', value: false, changed_at: '2026-10-28T06:30:00Z' });
    expect(m.vm.data.powerById.heater).toBe(false);
    expect(pond.getDeviceState).toHaveBeenCalledTimes(reads);
  });

  it('adds, renames and removes devices as the Pond reports them', async () => {
    const stream = streamOpens();
    const m = await mount();
    const lamp: Device = { id: 'lamp', name: 'Lamp', is_online: true };

    stream.emit({ type: 'device', seq: 1, change: 'added', device: lamp });
    stream.emit({ type: 'device', seq: 2, change: 'updated', device: { ...HEATER, name: 'Geyser' } });
    expect(m.vm.data.devices.map((d) => d.name).sort()).toEqual(['Geyser', 'Lamp']);

    stream.emit({ type: 'device', seq: 3, change: 'removed', device: lamp });
    expect(m.vm.data.devices.map((d) => d.id)).toEqual(['heater']);
  });

  it('reads everything once when the Pond says the phone fell too far behind', async () => {
    const stream = streamOpens();
    await mount();
    const lists = pond.listDevices.mock.calls.length;
    await act(async () => {
      stream.emit({ type: 'resync' });
    });
    expect(pond.listDevices).toHaveBeenCalledTimes(lists + 1);
  });

  it('is not opened again on a Pond without it', async () => {
    jest.useFakeTimers();
    try {
      pond.streamDeviceEvents.mockRejectedValue(new ApiError('x', 404, null));
      await mount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(120_000);
      });
      expect(pond.streamDeviceEvents).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('resumes after the last event when it drops', async () => {
    jest.useFakeTimers();
    try {
      const stream = streamOpens();
      await mount();
      stream.emit({ type: 'device_state', seq: 41, device_id: 'heater', key: 'power', value: true, changed_at: '2026-10-28T06:30:00Z' });
      await stream.end(new TypeError('Network request failed'));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5_000);
      });
      expect(pond.streamDeviceEvents).toHaveBeenLastCalledWith(expect.any(Function), expect.anything(), expect.any(Function), 41);
    } finally {
      jest.useRealTimers();
    }
  });
});
