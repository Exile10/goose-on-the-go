/**
 * A switch the Pond refused: the switch goes back, the list is not drawn as failed, and the
 * refusal is said in the snackbar with Try again -- on Home as well as Devices, which share this.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { currentSnackbar, resetSnackbar } from '@/services/snackbar';
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
      deleteDevice: jest.fn(),
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
  pond.getDeviceState.mockResolvedValue({ content: [{ type: 'text', text: '{"power":false}' }] } as never);
  pond.matterStatus.mockResolvedValue(null as never);
});

afterEach(async () => {
  for (const tree of mounted.splice(0)) await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

it('puts a refused switch back and says why in the snackbar, with Try again', async () => {
  pond.setDeviceState.mockRejectedValueOnce(new ApiError('POST', 404, null));
  const m = await mount();
  const before = m.vm.data.powerById.lamp;

  await act(async () => m.vm.actions.setState(LAMP, { power: true }));

  expect(m.vm.data.powerById.lamp).toBe(before);
  expect(m.vm.error).toBeNull();
  expect(currentSnackbar()).toMatchObject({ tone: 'danger', message: i18n.t('errors.deviceGone') });
  expect(currentSnackbar()?.action?.label).toBe(i18n.t('common.retry'));

  pond.setDeviceState.mockResolvedValueOnce(undefined as never);
  await act(async () => currentSnackbar()?.action?.onPress());
  expect(pond.setDeviceState).toHaveBeenCalledTimes(2);
  expect(pond.setDeviceState).toHaveBeenLastCalledWith('lamp', { power: true });
});

it('still says something when the shared reading has nothing to add', async () => {
  pond.setDeviceState.mockRejectedValue(new TypeError('Network request failed'));
  const m = await mount();

  await act(async () => m.vm.actions.setState(LAMP, { power: true }));

  expect(currentSnackbar()).toMatchObject({ tone: 'danger', message: i18n.t('errors.deviceNotSaved') });
});
