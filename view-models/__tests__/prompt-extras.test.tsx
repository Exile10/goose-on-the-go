/**
 * Assistant notes: what the model makes of a typed name, and what the view-model sends, keeps and
 * says for each answer the Pond can give.
 *
 * The failure worth guarding most is the quiet one. The Pond's POST is an upsert, so a new note
 * named like an old one would replace it without a word; and a refused switch or delete must not
 * look done.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { inPondOrder, keyFromName, newNote, nextSortOrder, noteName } from '@/models/prompt-extras';
import { ApiError, api } from '@/services/api-client';
import { currentSnackbar, resetSnackbar } from '@/services/snackbar';
import type { PromptExtra } from '@/services/types';
import { describePromptExtraError, usePromptExtras, type UsePromptExtras } from '@/view-models/use-prompt-extras';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: { listPromptExtras: jest.fn(), savePromptExtra: jest.fn(), deletePromptExtra: jest.fn() },
  };
});

const server = { hydrated: true, real: true };
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: server.hydrated, isScreenReal: () => server.real }),
}));

// The poll itself is `use-live.test.ts`'s business; here it is one read on mount.
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

const note = (key: string, over: Partial<PromptExtra> = {}): PromptExtra => ({
  key,
  instruction: `${key} words`,
  active: true,
  sort_order: 0,
  ...over,
});

const refusal = (status: number, detail: string | null = null) =>
  new ApiError(`POST /api/v1/agent/extras → ${status}`, status, null, detail);

interface Mounted {
  readonly vm: UsePromptExtras;
  unmount: () => Promise<void>;
}

async function mount(): Promise<Mounted> {
  let latest!: UsePromptExtras;
  const Probe = () => {
    latest = usePromptExtras();
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
  server.hydrated = true;
  server.real = true;
  pond.listPromptExtras.mockResolvedValue([]);
  pond.savePromptExtra.mockResolvedValue(undefined);
  pond.deletePromptExtra.mockResolvedValue(undefined);
});

describe('the model', () => {
  it('makes a key the Pond can write into the block name', () => {
    expect(keyFromName('  Home rules!  ')).toBe('home_rules');
    expect(keyFromName('Lugha ya Kiswahili')).toBe('lugha_ya_kiswahili');
    expect(keyFromName('Café "quotes" <tags>')).toBe('cafe_quotes_tags');
    expect(keyFromName('日本語')).toBe('');
    expect(keyFromName('a'.repeat(100))).toHaveLength(64);
  });

  it('reads a key back as a name', () => {
    expect(noteName('home_rules')).toBe('Home rules');
    expect(noteName('quiet-evenings')).toBe('Quiet evenings');
    expect(noteName('___')).toBe('___');
  });

  it('orders as the Pond does, and puts a new note last', () => {
    const list = [note('b', { sort_order: 1 }), note('c', { sort_order: 0 }), note('a', { sort_order: 1 })];
    expect(inPondOrder(list).map((e) => e.key)).toEqual(['c', 'a', 'b']);
    expect(nextSortOrder(list)).toBe(2);
    expect(nextSortOrder([])).toBe(0);
  });

  it('refuses a new note for each thing missing, and a name already taken', () => {
    const existing = [note('language')];
    expect(newNote(' ', 'x', existing)).toEqual({ problem: 'nameRequired' });
    expect(newNote('!!!', 'x', existing)).toEqual({ problem: 'nameUnusable' });
    expect(newNote('Language', 'x', existing)).toEqual({ problem: 'nameTaken' });
    expect(newNote('Tone', '   ', existing)).toEqual({ problem: 'textRequired' });
    expect(newNote('Tone', ' Be warm. ', existing)).toEqual({
      note: { key: 'tone', instruction: 'Be warm.', active: true, sort_order: 1 },
    });
  });
});

describe('reading', () => {
  it('shows the notes in the Pond order, inactive ones included', async () => {
    pond.listPromptExtras.mockResolvedValue([note('b', { sort_order: 2, active: false }), note('a', { sort_order: 1 })]);
    const m = await mount();

    expect(m.vm.data.extras.map((e) => e.key)).toEqual(['a', 'b']);
    expect(m.vm.loading).toBe(false);
    expect(m.vm.failed).toBe(false);
    await m.unmount();
  });

  it('says a Pond without the store cannot keep notes, rather than that it is empty', async () => {
    pond.listPromptExtras.mockRejectedValue(refusal(501, 'Prompt extra repository not configured'));
    const m = await mount();

    expect(m.vm.failed).toBe(true);
    expect(m.vm.error).toBe("This Pond can't keep notes. Update it to add them here.");
    await m.unmount();
  });

  it('reads nothing from the Pond on mock, and shows the samples', async () => {
    server.real = false;
    const m = await mount();

    expect(pond.listPromptExtras).not.toHaveBeenCalled();
    expect(m.vm.data.extras.length).toBeGreaterThan(0);
    await m.unmount();
  });
});

describe('adding and editing', () => {
  it('sends a new note once, active and last, and lists it', async () => {
    pond.listPromptExtras.mockResolvedValue([note('language')]);
    const m = await mount();

    let refused: string | null = 'unset';
    await act(async () => {
      refused = await m.vm.actions.add('Quiet evenings', 'Keep it short after 9 PM.');
    });

    expect(refused).toBeNull();
    expect(pond.savePromptExtra).toHaveBeenCalledTimes(1);
    expect(pond.savePromptExtra).toHaveBeenCalledWith({
      key: 'quiet_evenings',
      instruction: 'Keep it short after 9 PM.',
      active: true,
      sort_order: 1,
    });
    expect(m.vm.data.extras.map((e) => e.key)).toEqual(['language', 'quiet_evenings']);
    await m.unmount();
  });

  it('never sends a note whose name would replace another', async () => {
    pond.listPromptExtras.mockResolvedValue([note('language')]);
    const m = await mount();

    let refused: string | null = null;
    await act(async () => {
      refused = await m.vm.actions.add('LANGUAGE', 'Answer in French.');
    });

    expect(refused).toBe('There is already a note with that name. Edit that one, or choose another name.');
    expect(pond.savePromptExtra).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('rewords in place, keeping the key, the switch and the order', async () => {
    const old = note('language', { active: false, sort_order: 4 });
    pond.listPromptExtras.mockResolvedValue([old]);
    const m = await mount();

    await act(async () => {
      await m.vm.actions.edit(old, '  Answer in Swahili.  ');
    });

    expect(pond.savePromptExtra).toHaveBeenCalledWith({ key: 'language', instruction: 'Answer in Swahili.', active: false, sort_order: 4 });
    expect(m.vm.data.extras[0].instruction).toBe('Answer in Swahili.');
    await m.unmount();
  });

  it('keeps the words on screen and says why when the Pond refuses them', async () => {
    const old = note('language');
    pond.listPromptExtras.mockResolvedValue([old]);
    pond.savePromptExtra.mockRejectedValue(refusal(400, 'missing field `instruction`'));
    const m = await mount();

    let refused: string | null = null;
    await act(async () => {
      refused = await m.vm.actions.edit(old, 'New words');
    });

    expect(refused).toBe('missing field `instruction`');
    expect(m.vm.data.extras[0].instruction).toBe('language words');
    await m.unmount();
  });

  it('has a sentence for a refusal the shared reading would leave to the banner', async () => {
    pond.savePromptExtra.mockRejectedValue(new Error('network'));
    const m = await mount();

    let refused: string | null = null;
    await act(async () => {
      refused = await m.vm.actions.add('Tone', 'Be warm.');
    });

    expect(refused).toBe("Couldn't save the note. Try again.");
    expect(m.vm.data.extras).toEqual([]);
    await m.unmount();
  });
});

describe('switching and deleting', () => {
  it('switches a note off with the rest of it unchanged', async () => {
    const old = note('language', { sort_order: 2 });
    pond.listPromptExtras.mockResolvedValue([old]);
    const m = await mount();

    await act(async () => m.vm.actions.setActive(old, false));

    expect(pond.savePromptExtra).toHaveBeenCalledWith({ ...old, active: false });
    expect(m.vm.data.extras[0].active).toBe(false);
    expect(currentSnackbar()).toBeNull();
    await m.unmount();
  });

  it('leaves a refused switch as it was and says so', async () => {
    const old = note('language');
    pond.listPromptExtras.mockResolvedValue([old]);
    pond.savePromptExtra.mockRejectedValue(refusal(500));
    const m = await mount();

    await act(async () => m.vm.actions.setActive(old, false));

    expect(m.vm.data.extras[0].active).toBe(true);
    expect(m.vm.error).toBeNull();
    expect(currentSnackbar()?.tone).toBe('danger');

    pond.savePromptExtra.mockResolvedValue();
    await act(async () => currentSnackbar()?.action?.onPress());
    expect(m.vm.data.extras[0].active).toBe(false);
    await m.unmount();
  });

  it('deletes by key once', async () => {
    const old = note('language');
    pond.listPromptExtras.mockResolvedValue([old, note('tone', { sort_order: 1 })]);
    const m = await mount();

    await act(async () => m.vm.actions.remove(old));

    expect(pond.deletePromptExtra).toHaveBeenCalledTimes(1);
    expect(pond.deletePromptExtra).toHaveBeenCalledWith('language');
    expect(m.vm.data.extras.map((e) => e.key)).toEqual(['tone']);
    await m.unmount();
  });

  it('puts a note back, in its place, when the delete is refused', async () => {
    const old = note('language');
    pond.listPromptExtras.mockResolvedValue([old, note('tone', { sort_order: 1 })]);
    pond.deletePromptExtra.mockRejectedValue(refusal(500));
    const m = await mount();

    await act(async () => m.vm.actions.remove(old));

    expect(m.vm.data.extras.map((e) => e.key)).toEqual(['language', 'tone']);
    expect(m.vm.error).toBeNull();
    expect(currentSnackbar()).toMatchObject({ tone: 'danger', action: { label: 'Try again' } });
    await m.unmount();
  });
});

it('leaves an auth refusal to the connection banner', () => {
  expect(describePromptExtraError(refusal(401))).toBeNull();
});
