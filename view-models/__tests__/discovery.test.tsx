/**
 * The pairing wizard's search: what it found, when it gives up, and Search again starting over.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { startDiscovery, type DiscoveredPond } from '@/services/discovery';
import { useDiscovery, type UseDiscovery } from '@/view-models/use-discovery';

jest.mock('@/services/discovery', () => ({
  SEARCH_TIMEOUT_MS: 8_000,
  startDiscovery: jest.fn(),
}));

const start = jest.mocked(startDiscovery);
const stop = jest.fn();
const pond = { name: 'Home Pond', url: 'https://pond.local:8443' } as DiscoveredPond;

async function mount() {
  let latest!: UseDiscovery;
  const Probe = () => {
    latest = useDiscovery();
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
    unmount: () => act(async () => tree.unmount()),
  };
}

/** What the search reports through, for the latest start. */
function reporters() {
  const [onFound, onError] = start.mock.calls[start.mock.calls.length - 1];
  return { onFound, onError };
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.useFakeTimers();
  start.mockReset().mockReturnValue({ stop });
  stop.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

it('shows what it found', async () => {
  const m = await mount();
  expect(m.vm.data.phase).toBe('searching');
  act(() => reporters().onFound([pond]));
  expect(m.vm.data).toEqual({ ponds: [pond], phase: 'found' });
  await m.unmount();
  expect(stop).toHaveBeenCalled();
});

it('says nothing was found once the search times out', async () => {
  const m = await mount();
  act(() => jest.advanceTimersByTime(8_000));
  expect(m.vm.data.phase).toBe('empty');
  await m.unmount();
});

it('starts again from nothing on Search again', async () => {
  const m = await mount();
  act(() => reporters().onError('No network'));
  act(() => jest.advanceTimersByTime(8_000));
  expect(m.vm.data.phase).toBe('failed');

  await act(async () => m.vm.actions.retry());
  expect(start).toHaveBeenCalledTimes(2);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(m.vm.error).toBeNull();
  expect(m.vm.data).toEqual({ ponds: [], phase: 'searching' });
  await m.unmount();
});
