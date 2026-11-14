/**
 * What Goose did: an entry the member takes back is marked at once and comes back when the Pond
 * refuses, and a look at the list clears what was new.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { readGooseActivity, type GooseActivityList } from '@/models/goose-activity';
import { ApiError, api } from '@/services/api-client';
import { currentSnackbar, resetSnackbar } from '@/services/snackbar';
import { useGooseActivity, type UseGooseActivity } from '@/view-models/use-goose-activity';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/secure-random', () => ({ randomBytes: (n: number) => new Uint8Array(n).fill(7) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { gooseActivity: jest.fn(), undoGooseActivity: jest.fn(), markGooseActivitySeen: jest.fn() } };
});
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true, isScreenReal: () => true }) }));

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

function held(): GooseActivityList {
  return readGooseActivity({
    activity: [
      { id: 'a1', kind: 'reminder', summary: 'Set a reminder for Fri 08:00: Call the dentist', at: '2026-11-12T19:00:00+00:00', can_undo: true, undone: false },
      { id: 'a2', kind: 'errand', summary: 'Looked into: when the pool opens', detail: 'It opens at 6am.', at: '2026-11-12T18:00:00+00:00', can_undo: false },
      { id: 'a3', kind: 'something-newer', summary: 'A kind this app has not met', at: 'not a time' },
      { id: '', kind: 'note', summary: 'No id' },
    ],
    unseen: 2,
  });
}

async function mount(): Promise<{ readonly vm: UseGooseActivity; unmount: () => Promise<void> }> {
  let latest!: UseGooseActivity;
  const Probe = () => {
    latest = useGooseActivity();
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
    unmount: async () => {
      await act(async () => tree.unmount());
    },
  };
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  resetSnackbar();
  jest.resetAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  pond.gooseActivity.mockImplementation(async () => held());
  pond.undoGooseActivity.mockResolvedValue(undefined);
  pond.markGooseActivitySeen.mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('What Goose did', () => {
  it('reads the entries, and one of a kind it does not know still shows its line', async () => {
    const m = await mount();

    expect(m.vm.data.items.map((e) => e.id)).toEqual(['a1', 'a2', 'a3']);
    expect(m.vm.data.items[1].detail).toBe('It opens at 6am.');
    expect(m.vm.data.items[2]).toMatchObject({ kind: 'note_closed', at: null, canUndo: false });
    expect(m.vm.data.unseen).toBe(2);
    await m.unmount();
  });

  it('marks an entry taken back at once and tells the Pond', async () => {
    const m = await mount();

    await act(async () => {
      await m.vm.actions.undo(m.vm.data.items[0]);
    });

    expect(pond.undoGooseActivity).toHaveBeenCalledWith('a1');
    expect(m.vm.data.items[0]).toMatchObject({ undone: true, canUndo: false });
    expect(currentSnackbar()?.tone).toBe('success');
    await m.unmount();
  });

  it('puts the entry back as it was when the Pond refuses', async () => {
    pond.undoGooseActivity.mockRejectedValue(new ApiError('POST → 409', 409, null));
    const m = await mount();

    await act(async () => {
      await m.vm.actions.undo(m.vm.data.items[0]);
    });

    expect(m.vm.data.items[0]).toMatchObject({ undone: false, canUndo: true });
    await m.unmount();
  });

  it('never asks the Pond to take back what cannot be', async () => {
    const m = await mount();

    await act(async () => {
      await m.vm.actions.undo(m.vm.data.items[1]);
    });

    expect(pond.undoGooseActivity).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('clears what was new once the member has looked', async () => {
    const m = await mount();

    await act(async () => {
      await m.vm.actions.markSeen();
    });
    await act(async () => {
      await m.vm.actions.markSeen();
    });

    expect(m.vm.data.unseen).toBe(0);
    expect(pond.markGooseActivitySeen).toHaveBeenCalledTimes(1);
    await m.unmount();
  });
});
