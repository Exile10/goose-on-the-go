/**
 * About you: where a fact is filed on the phone before the Pond answers, that every change shows
 * at once and is put back when the Pond refuses, and that bringing a memory back takes it off the
 * set-aside list.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { AboutFact, AboutProfile, AboutWord, ArchivedFact } from '@/models/about';
import { ApiError, api } from '@/services/api-client';
import { currentSnackbar, resetSnackbar } from '@/services/snackbar';
import { NEW_FACT, useAbout, useArchivedAbout, withFact, withoutFact, type UseAbout, type UseArchivedAbout } from '@/view-models/use-about';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/secure-random', () => ({ randomBytes: (n: number) => new Uint8Array(n).fill(7) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      about: jest.fn(),
      addAboutFact: jest.fn(),
      editAboutFact: jest.fn(),
      deleteAboutFact: jest.fn(),
      archivedAbout: jest.fn(),
      restoreAboutFact: jest.fn(),
    },
  };
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

const WORDS: AboutWord[] = [
  { about: 'name', heading: 'Who they are', oneAtATime: true },
  { about: 'friend', heading: 'People', oneAtATime: false },
  { about: 'diet', heading: 'Food and health', oneAtATime: true },
  { about: 'allergy', heading: 'Food and health', oneAtATime: false },
  { about: 'likes', heading: 'Preferences', oneAtATime: false },
];

function fact(id: string, content: string, about: string | null, over: Partial<AboutFact> = {}): AboutFact {
  return { id, content, about, sensitive: false, shared: false, createdAt: '2026-11-01T09:00:00+00:00', expiresAt: null, ...over };
}

const NAME = fact('f-name', 'Jerry goes by Jerry.', 'name');
const DIET = fact('f-diet', 'Jerry eats meat.', 'diet');
const NUTS = fact('f-nuts', 'Jerry is allergic to peanuts.', 'allergy', { sensitive: true });
const HOUSE = fact('f-house', 'The household keeps no pork.', 'diet', { shared: true });
const OLD = fact('f-old', 'Jerry mentioned a trip.', null);

function profile(): AboutProfile {
  return {
    headings: [
      { segment: 'identity', heading: 'Who they are', facts: [NAME] },
      { segment: 'food_health', heading: 'Food and health', facts: [DIET, NUTS, HOUSE] },
      { segment: 'other', heading: 'Other', facts: [OLD] },
    ],
    toFile: 1,
    words: WORDS,
  };
}

function archivedFact(id: string, why: string | null = 'a task, not a fact'): ArchivedFact {
  return { ...fact(id, `Sentence ${id}.`, null), why };
}

/** Each heading with the ids under it, in order. */
function shape(p: AboutProfile): [string, string[]][] {
  return p.headings.map((h) => [h.heading, h.facts.map((f) => f.id)]);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function mount<T>(useIt: () => T): Promise<{ readonly vm: T; unmount: () => Promise<void> }> {
  let latest!: T;
  const Probe = () => {
    latest = useIt();
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
  pond.about.mockImplementation(async () => profile());
  pond.archivedAbout.mockResolvedValue([archivedFact('a1'), archivedFact('a2')]);
});

afterEach(() => jest.restoreAllMocks());

describe('where a fact is filed', () => {
  it('puts a new fact at the foot of its word’s heading', () => {
    const next = withFact(profile(), fact('f-shell', 'Jerry is allergic to shellfish.', 'allergy'));

    expect(shape(next)[1]).toEqual(['Food and health', ['f-diet', 'f-nuts', 'f-house', 'f-shell']]);
  });

  it('makes a heading that had no fact, where the profile’s order puts it', () => {
    const next = withFact(profile(), fact('f-jazz', 'Jerry likes jazz.', 'likes'));

    expect(shape(next).map(([heading]) => heading)).toEqual(['Who they are', 'Food and health', 'Preferences', 'Other']);
  });

  it('keeps one of the member’s own under a one-at-a-time word when adding, and leaves the household’s', () => {
    const next = withFact(profile(), fact('f-veg', 'Jerry is vegetarian.', 'diet'), true);

    expect(shape(next)[1]).toEqual(['Food and health', ['f-nuts', 'f-house', 'f-veg']]);
  });

  it('rewords a fact where it stands', () => {
    const next = withFact(profile(), { ...NUTS, content: 'Jerry is allergic to all nuts.' });

    expect(shape(next)).toEqual(shape(profile()));
    expect(next.headings[1].facts[1].content).toBe('Jerry is allergic to all nuts.');
  });

  it('moves an older fact under the word it is filed with, and counts one fewer still to sort', () => {
    const next = withFact(profile(), { ...OLD, about: 'friend' });

    expect(shape(next)).toEqual([
      ['Who they are', ['f-name']],
      ['People', ['f-old']],
      ['Food and health', ['f-diet', 'f-nuts', 'f-house']],
    ]);
    expect(next.toFile).toBe(0);
  });

  it('drops a heading with its last fact', () => {
    expect(shape(withoutFact(profile(), 'f-name')).map(([heading]) => heading)).toEqual(['Food and health', 'Other']);
  });
});

describe('the profile', () => {
  it('reads the headings and how many memories were set aside', async () => {
    const m = await mount<UseAbout>(useAbout);

    expect(shape(m.vm.profile)).toEqual(shape(profile()));
    expect(m.vm.setAside).toBe(2);
    expect(m.vm.failed).toBe(false);
    await m.unmount();
  });

  it('shows the profile when only the set-aside count would not load', async () => {
    pond.archivedAbout.mockRejectedValue(new ApiError('GET → 500', 500, null));
    const m = await mount<UseAbout>(useAbout);

    expect(m.vm.profile.headings).toHaveLength(3);
    expect(m.vm.setAside).toBe(0);
    expect(m.vm.failed).toBe(false);
    await m.unmount();
  });
});

describe('adding a fact', () => {
  it('shows it at once under its heading, then keeps the Pond’s row', async () => {
    const gate = deferred<AboutFact>();
    pond.addAboutFact.mockReturnValue(gate.promise);
    const m = await mount<UseAbout>(useAbout);

    let refused!: Promise<string | null>;
    await act(async () => {
      refused = m.vm.actions.add('  I am vegetarian. ', 'diet');
    });
    const shown = m.vm.profile.headings[1].facts;
    expect(shown.map((f) => f.content)).toEqual(['Jerry is allergic to peanuts.', 'The household keeps no pork.', 'I am vegetarian.']);
    expect(m.vm.busy).toBe(NEW_FACT);
    expect(pond.addAboutFact).toHaveBeenCalledWith('I am vegetarian.', 'diet');

    await act(async () => {
      gate.resolve(fact('f-veg', 'Jerry is vegetarian.', 'diet'));
      await refused;
    });
    await expect(refused).resolves.toBeNull();
    expect(shape(m.vm.profile)[1]).toEqual(['Food and health', ['f-nuts', 'f-house', 'f-veg']]);
    expect(m.vm.busy).toBeNull();
    expect(currentSnackbar()).toMatchObject({ message: 'Saved', tone: 'success' });
    await m.unmount();
  });

  it('puts the profile back and says why when the Pond refuses', async () => {
    pond.addAboutFact.mockRejectedValue(new ApiError('POST → 400', 400, null, 'about must be one of: name'));
    const m = await mount<UseAbout>(useAbout);

    let refused: string | null = null;
    await act(async () => {
      refused = await m.vm.actions.add('I am vegetarian.', 'diet');
    });

    expect(refused).toBe('Your Pond could not finish that.');
    expect(m.vm.profile).toEqual(profile());
    expect(m.vm.busy).toBeNull();
    expect(currentSnackbar()).toBeNull();
    await m.unmount();
  });

  it('still has a sentence for the open sheet when the Pond never answered', async () => {
    pond.addAboutFact.mockRejectedValue(new TypeError('Network request failed'));
    const m = await mount<UseAbout>(useAbout);

    let refused: string | null = null;
    await act(async () => {
      refused = await m.vm.actions.add('I am vegetarian.', 'diet');
    });

    expect(refused).toBe('Your Pond could not do that. Try again in a moment.');
    expect(m.vm.profile).toEqual(profile());
    await m.unmount();
  });
});

describe('rewording and filing a fact', () => {
  it('sends only the new words, shown at once', async () => {
    const gate = deferred<AboutFact>();
    pond.editAboutFact.mockReturnValue(gate.promise);
    const m = await mount<UseAbout>(useAbout);

    let refused!: Promise<string | null>;
    await act(async () => {
      refused = m.vm.actions.edit(NUTS, { content: 'Jerry is allergic to all nuts. ', about: 'allergy' });
    });
    expect(pond.editAboutFact).toHaveBeenCalledWith('f-nuts', { content: 'Jerry is allergic to all nuts.' });
    expect(m.vm.profile.headings[1].facts[1].content).toBe('Jerry is allergic to all nuts.');
    expect(m.vm.busy).toBe('f-nuts');

    await act(async () => {
      gate.resolve({ ...NUTS, content: 'Jerry is allergic to all nuts.' });
      await refused;
    });
    expect(shape(m.vm.profile)).toEqual(shape(profile()));
    expect(currentSnackbar()).toMatchObject({ message: 'Saved', tone: 'success' });
    await m.unmount();
  });

  it('puts the old words back when the Pond refuses', async () => {
    pond.editAboutFact.mockRejectedValue(new ApiError('PATCH → 404', 404, null));
    const m = await mount<UseAbout>(useAbout);

    let refused: string | null = null;
    await act(async () => {
      refused = await m.vm.actions.edit(NUTS, { content: 'Jerry is allergic to all nuts.' });
    });

    expect(refused).toBe('Your Pond could not finish that.');
    expect(m.vm.profile).toEqual(profile());
    await m.unmount();
  });

  it('files it under another word without resending its words', async () => {
    pond.editAboutFact.mockResolvedValue({ ...OLD, about: 'friend' });
    const m = await mount<UseAbout>(useAbout);

    await act(async () => {
      await m.vm.actions.edit(OLD, { content: OLD.content, about: 'friend' });
    });

    expect(pond.editAboutFact).toHaveBeenCalledWith('f-old', { about: 'friend' });
    expect(shape(m.vm.profile)[1]).toEqual(['People', ['f-old']]);
    expect(m.vm.profile.toFile).toBe(0);
    await m.unmount();
  });

  it('asks the Pond nothing when nothing changed', async () => {
    const m = await mount<UseAbout>(useAbout);

    let refused: string | null = 'unset';
    await act(async () => {
      refused = await m.vm.actions.edit(NUTS, { content: NUTS.content, about: 'allergy' });
    });

    expect(refused).toBeNull();
    expect(pond.editAboutFact).not.toHaveBeenCalled();
    expect(currentSnackbar()).toBeNull();
    await m.unmount();
  });
});

describe('deleting a fact', () => {
  it('takes it off at once, and its heading with it when it was the last', async () => {
    const gate = deferred<void>();
    pond.deleteAboutFact.mockReturnValue(gate.promise);
    const m = await mount<UseAbout>(useAbout);

    let refused!: Promise<string | null>;
    await act(async () => {
      refused = m.vm.actions.remove(NAME);
    });
    expect(shape(m.vm.profile).map(([heading]) => heading)).toEqual(['Food and health', 'Other']);
    expect(pond.deleteAboutFact).toHaveBeenCalledWith('f-name');

    await act(async () => {
      gate.resolve();
      await refused;
    });
    await expect(refused).resolves.toBeNull();
    expect(shape(m.vm.profile).map(([heading]) => heading)).toEqual(['Food and health', 'Other']);
    expect(currentSnackbar()).toMatchObject({ message: 'Deleted', tone: 'success' });
    await m.unmount();
  });

  it('puts it back where it was when the Pond refuses', async () => {
    pond.deleteAboutFact.mockRejectedValue(new ApiError('DELETE → 503', 503, null));
    const m = await mount<UseAbout>(useAbout);

    let refused: string | null = null;
    await act(async () => {
      refused = await m.vm.actions.remove(NUTS);
    });

    expect(refused).toBe('Your Pond is busy right now.');
    expect(m.vm.profile).toEqual(profile());
    await m.unmount();
  });
});

describe('what was set aside', () => {
  it('takes a memory off the list as it is brought back', async () => {
    const gate = deferred<AboutFact>();
    pond.restoreAboutFact.mockReturnValue(gate.promise);
    const m = await mount<UseArchivedAbout>(useArchivedAbout);
    expect(m.vm.data.map((f) => f.id)).toEqual(['a1', 'a2']);
    expect(m.vm.data[0].why).toBe('a task, not a fact');

    let done!: Promise<void>;
    await act(async () => {
      done = m.vm.actions.restore(m.vm.data[0]);
    });
    expect(m.vm.data.map((f) => f.id)).toEqual(['a2']);
    expect(pond.restoreAboutFact).toHaveBeenCalledWith('a1');

    await act(async () => {
      gate.resolve(fact('a1', 'Sentence a1.', null));
      await done;
    });
    expect(m.vm.data.map((f) => f.id)).toEqual(['a2']);
    expect(currentSnackbar()).toMatchObject({ message: 'Brought back', tone: 'success' });
    await m.unmount();
  });

  it('puts the row back in its place when the Pond refuses', async () => {
    pond.restoreAboutFact.mockRejectedValue(new ApiError('POST → 409', 409, null));
    const m = await mount<UseArchivedAbout>(useArchivedAbout);

    await act(async () => {
      await m.vm.actions.restore(m.vm.data[0]);
    });

    expect(m.vm.data.map((f) => f.id)).toEqual(['a1', 'a2']);
    expect(currentSnackbar()).toMatchObject({ message: 'Your Pond could not finish that.', tone: 'danger' });
    await m.unmount();
  });
});
