/**
 * Goose's notes: a note the member deletes goes at once, from whichever list holds it, and comes
 * back in its place when the Pond refuses.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { GooseNote, GooseNotes } from '@/models/goose-notes';
import { ApiError, api } from '@/services/api-client';
import { currentSnackbar, resetSnackbar } from '@/services/snackbar';
import { useGooseNotes, type UseGooseNotes } from '@/view-models/use-goose-notes';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/secure-random', () => ({ randomBytes: (n: number) => new Uint8Array(n).fill(7) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { gooseNotes: jest.fn(), deleteGooseNote: jest.fn() } };
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

function note(id: string, shared = false): GooseNote {
  return { id, text: `Note ${id}.`, createdAt: '2026-11-02T08:00:00+00:00', shared };
}

function held(): GooseNotes {
  return { lessons: [note('l1'), note('l2', true), note('l3')], notes: [note('n1'), note('n2')] };
}

const ids = (notes: GooseNotes) => ({ lessons: notes.lessons.map((n) => n.id), notes: notes.notes.map((n) => n.id) });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function mount(): Promise<{ readonly vm: UseGooseNotes; unmount: () => Promise<void> }> {
  let latest!: UseGooseNotes;
  const Probe = () => {
    latest = useGooseNotes();
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
  pond.gooseNotes.mockImplementation(async () => held());
  pond.deleteGooseNote.mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('Goose’s notes', () => {
  it('reads what Goose learned and what it is keeping an eye on', async () => {
    const m = await mount();

    expect(ids(m.vm.data)).toEqual({ lessons: ['l1', 'l2', 'l3'], notes: ['n1', 'n2'] });
    expect(m.vm.data.lessons[1].shared).toBe(true);
    await m.unmount();
  });

  it('takes a deleted lesson off at once and tells the Pond', async () => {
    const gate = deferred<void>();
    pond.deleteGooseNote.mockReturnValue(gate.promise);
    const m = await mount();

    let done!: Promise<void>;
    await act(async () => {
      done = m.vm.actions.remove(m.vm.data.lessons[1]);
    });
    expect(ids(m.vm.data)).toEqual({ lessons: ['l1', 'l3'], notes: ['n1', 'n2'] });
    expect(pond.deleteGooseNote).toHaveBeenCalledWith('l2');
    expect(currentSnackbar()).toBeNull();

    await act(async () => {
      gate.resolve();
      await done;
    });
    expect(ids(m.vm.data)).toEqual({ lessons: ['l1', 'l3'], notes: ['n1', 'n2'] });
    expect(currentSnackbar()).toMatchObject({ message: 'Note deleted', tone: 'success' });
    await m.unmount();
  });

  it('deletes a follow-up from its own list', async () => {
    const m = await mount();

    await act(async () => {
      await m.vm.actions.remove(m.vm.data.notes[0]);
    });

    expect(ids(m.vm.data)).toEqual({ lessons: ['l1', 'l2', 'l3'], notes: ['n2'] });
    expect(pond.deleteGooseNote).toHaveBeenCalledWith('n1');
    await m.unmount();
  });

  it('puts the note back in its place when the Pond refuses', async () => {
    pond.deleteGooseNote.mockRejectedValue(new ApiError('DELETE → 500', 500, null));
    const m = await mount();

    await act(async () => {
      await m.vm.actions.remove(m.vm.data.lessons[1]);
    });

    expect(ids(m.vm.data)).toEqual({ lessons: ['l1', 'l2', 'l3'], notes: ['n1', 'n2'] });
    expect(currentSnackbar()).toMatchObject({ message: 'Your Pond is busy right now.', tone: 'danger' });
    await m.unmount();
  });

  it('leaves another delete alone when one is refused', async () => {
    const first = deferred<void>();
    pond.deleteGooseNote.mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined);
    const m = await mount();

    let refused!: Promise<void>;
    await act(async () => {
      refused = m.vm.actions.remove(m.vm.data.lessons[0]);
    });
    await act(async () => {
      await m.vm.actions.remove(m.vm.data.lessons[1]);
    });
    await act(async () => {
      first.reject(new ApiError('DELETE → 500', 500, null));
      await refused;
    });

    expect(ids(m.vm.data).lessons).toEqual(['l1', 'l2']);
    await m.unmount();
  });
});
