/**
 * Switching a device: the tap waits for the Pond, and the device's state changes
 * only to what the Pond read back from it.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { api } from '@/services/api-client';
import type { Device } from '@/services/types';
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
    },
  };
});

jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: true }),
}));

jest.mock('../use-live', () => ({
  useLive: (read: () => Promise<unknown>, _delay: unknown, enabled = true) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      if (enabled) void read();
    }, [enabled]);
  },
}));

const pond = jest.mocked(api);

const HEATER: Device = { id: 'heater', name: 'Water heater', is_online: true, capabilities: ['power'] };

const power = (on: boolean) => ({ content: `power: ${on ? 'on' : 'off'}`, success: true });

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
