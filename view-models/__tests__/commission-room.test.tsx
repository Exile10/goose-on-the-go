/**
 * Adding a device from setup's rooms step (issue #166): it lands in the room chosen there, and a
 * room that did not take never costs the device that was added.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import { resetSnackbar } from '@/services/snackbar';
import type { Device } from '@/services/types';
import { useDevices, type UseDevices } from '@/view-models/use-devices';

jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      listDevices: jest.fn(),
      listRooms: jest.fn(),
      getDeviceState: jest.fn(),
      setDeviceState: jest.fn(),
      deleteDevice: jest.fn(),
      matterStatus: jest.fn(),
      commissionDevice: jest.fn(),
      updateDevice: jest.fn(),
    },
  };
});

// The event stream only opens while the screen is in front, and there is no navigator here.
jest.mock('../use-screen-active', () => ({ useScreenActive: () => false }));
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: true }),
}));

jest.mock('../use-live', () => ({
  useLive: (read: () => Promise<unknown>, _delay: unknown, enabled = true) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      if (enabled) void read();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);
  },
}));

const pond = jest.mocked(api);

const LAMP: Device = { id: 'lamp', name: 'Lamp', is_online: true, capabilities: ['power'] } as Device;

const mounted: ReactTestRenderer[] = [];

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

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.resetAllMocks();
  resetSnackbar();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  pond.listDevices.mockResolvedValue([LAMP]);
  pond.listRooms.mockResolvedValue([]);
  pond.getDeviceState.mockResolvedValue({ content: [{ type: 'text', text: '{"power":false}' }] } as never);
  pond.matterStatus.mockResolvedValue(null as never);
});

afterEach(async () => {
  for (const tree of mounted.splice(0)) await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

it('adds the device, then puts it in the room it was given', async () => {
  pond.commissionDevice.mockResolvedValue({ id: 'matter-7', name: 'Porch light', node_id: '7' });
  pond.updateDevice.mockResolvedValue({ id: 'matter-7', name: 'Porch light', is_online: true, room_id: 'porch' });
  const m = await mount();

  let id: string | null = null;
  await act(async () => {
    id = await m.vm.actions.commission('34970112332', 'Porch light', 'porch');
  });

  expect(id).toBe('matter-7');
  expect(pond.updateDevice).toHaveBeenCalledWith('matter-7', { name: 'Porch light', room_id: 'porch' });
});

it('adds the device with no room when none was given', async () => {
  pond.commissionDevice.mockResolvedValue({ id: 'matter-7', name: 'Porch light', node_id: '7' });
  const m = await mount();
  await act(async () => {
    await m.vm.actions.commission('34970112332');
  });
  expect(pond.updateDevice).not.toHaveBeenCalled();
});

it('still reports the device added when its room was refused', async () => {
  pond.commissionDevice.mockResolvedValue({ id: 'matter-7', name: 'Porch light', node_id: '7' });
  pond.updateDevice.mockRejectedValue(new ApiError('PUT', 404, null));
  const m = await mount();

  let id: string | null = null;
  await act(async () => {
    id = await m.vm.actions.commission('34970112332', undefined, 'gone');
  });

  expect(id).toBe('matter-7');
  expect(m.vm.error).toBeNull();
});
