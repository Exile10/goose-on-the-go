/**
 * The Saved view-model: the read on arrival, a refresh somebody asks for, and a change of
 * collection, which reads that collection at once rather than at the next poll.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import type { SavedItem } from '@/models/web-watches';
import { useSavedItems } from '@/view-models/use-saved-items';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/secure-random', () => ({ randomBytes: (n: number) => new Uint8Array(n).fill(7) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { listSavedItems: jest.fn(), savedCollections: jest.fn() } };
});
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true }) }));

// The poll is `use-live.test.ts`'s business; here it is one read on mount.
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
const card = { id: 'c1', title: 'Rice cooker' } as SavedItem;

type View = ReturnType<typeof useSavedItems>;

async function mount() {
  let latest!: View;
  const Probe = () => {
    latest = useSavedItems();
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

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.resetAllMocks();
  pond.savedCollections.mockResolvedValue([]);
});

it('reads every collection on arrival and stops loading', async () => {
  pond.listSavedItems.mockResolvedValue([card]);
  const m = await mount();
  expect(pond.listSavedItems).toHaveBeenCalledWith(undefined);
  expect(m.vm.data.items).toEqual([card]);
  expect(m.vm.loading).toBe(false);
  await m.unmount();
});

it('reads a chosen collection at once, showing it is loading until it lands', async () => {
  pond.listSavedItems.mockResolvedValue([]);
  const m = await mount();
  let answer!: (items: SavedItem[]) => void;
  pond.listSavedItems.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));

  act(() => m.vm.actions.setCollection('kitchen'));
  expect(m.vm.data.collection).toBe('kitchen');
  expect(m.vm.loading).toBe(true);
  expect(pond.listSavedItems).toHaveBeenLastCalledWith('kitchen');

  await act(async () => answer([card]));
  expect(m.vm.loading).toBe(false);
  expect(m.vm.data.items).toEqual([card]);
  await m.unmount();
});

it('clears a failed read once a refresh succeeds', async () => {
  pond.listSavedItems.mockRejectedValueOnce(new ApiError('GET /api/v1/saved → 500', 500, null));
  const m = await mount();
  expect(m.vm.error).not.toBeNull();

  pond.listSavedItems.mockResolvedValue([card]);
  await act(async () => m.vm.actions.refresh());
  expect(m.vm.error).toBeNull();
  expect(m.vm.data.items).toEqual([card]);
  await m.unmount();
});
