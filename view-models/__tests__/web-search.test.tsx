/**
 * The Web search view-model: what it reports for each status the Pond can answer, what saving
 * does to the key field, and what a failed read, save or removal leaves on screen.
 *
 * The thing this screen must never do is hold on to a key. It is a write-only field: the Pond
 * never sends one back, so the only copy the app ever has is what was typed, and it has to be
 * gone once the Pond has it. Several tests here look for the key anywhere in the view-model's
 * output rather than only in the field it is supposed to have left.
 */

import i18n from '@/services/i18n';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import * as WebBrowser from 'expo-web-browser';

import { BRAVE_DASHBOARD_URL } from '@/models/web-search';
import { ApiError, api } from '@/services/api-client';
import type { WebSearchState, WebSearchStatus } from '@/services/types';
import { nearbyNote, statusLabel, useWebSearch, type UseWebSearch } from '@/view-models/use-web-search';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      webSearchState: jest.fn(),
      setWebSearchKey: jest.fn(),
      removeWebSearchKey: jest.fn(),
      updateSettings: jest.fn(),
    },
  };
});

// The provider is not what is under test; the two things the view-model asks of it are.
const server = { hydrated: true, real: true };
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: server.hydrated, isScreenReal: () => server.real }),
}));

// The poll itself is `use-live.test.ts`'s business. Here it is a read on mount, and the read is
// kept so a test can fire a poll by hand.
let poll: (() => Promise<unknown>) | null = null;
jest.mock('../use-live', () => ({
  useLive: (read: () => Promise<unknown>, _delay: unknown, enabled = true) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    poll = read;
    useEffect(() => {
      if (enabled) void read();
      // The real loop restarts on `enabled` alone, and so does this.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);
  },
}));

const web = jest.mocked(api);

const stored = (status: WebSearchStatus): WebSearchState => ({ provider: 'brave', configured: true, status });
const OFF: WebSearchState = { provider: 'brave', configured: false, status: 'not_configured' };
const withNearby = (enabled: boolean, town: string | null, state: WebSearchState = OFF): WebSearchState => ({
  ...state,
  local_results: { enabled, town },
});
const refusal = (status: number, detail: string | null = null) =>
  new ApiError(`PUT /api/v1/web-search/key → ${status}`, status, null, detail);

/** A promise the test settles by hand, to hold a request in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Mounted {
  readonly vm: UseWebSearch;
  unmount: () => Promise<void>;
}

async function mount(): Promise<Mounted> {
  let latest!: UseWebSearch;
  const Probe = () => {
    latest = useWebSearch();
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

/** Types into the key field, as the screen's `onChangeText` does. */
async function type(m: Mounted, text: string) {
  await act(async () => m.vm.actions.setDraft(text));
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(WebBrowser.openBrowserAsync).mockResolvedValue({ type: 'opened' } as never);
  server.hydrated = true;
  server.real = true;
  poll = null;
  web.webSearchState.mockResolvedValue(OFF);
});

describe('what the Pond reports', () => {
  /** The sentences are section 8.5's table, pinned in full: the contract is the source of copy. */
  it.each<[WebSearchStatus, string]>([
    ['ok', 'On, searching with Brave'],
    ['not_configured', 'Off'],
    ['rejected', 'Brave did not accept the key'],
    ['quota', "This month's free searches are used up"],
    ['unverified', 'Saved, not yet checked'],
  ])('says %s as "%s"', async (status, sentence) => {
    web.webSearchState.mockResolvedValue(
      status === 'not_configured' ? OFF : stored(status),
    );
    const m = await mount();

    expect(m.vm.data.status).toBe(status);
    expect(statusLabel(status, i18n.t)).toBe(sentence);
    await m.unmount();
  });

  it('offers Remove only while a key is stored', async () => {
    web.webSearchState.mockResolvedValue(OFF);
    const off = await mount();
    expect(off.vm.data.configured).toBe(false);
    await off.unmount();

    // Every status with a key behind it, including the ones that are bad news.
    for (const status of ['ok', 'rejected', 'quota', 'unverified'] as const) {
      web.webSearchState.mockResolvedValue(stored(status));
      const on = await mount();
      expect(on.vm.data.configured).toBe(true);
      await on.unmount();
    }
  });

  it('is loading, with nothing known, until the Pond answers', async () => {
    const read = deferred<WebSearchState>();
    web.webSearchState.mockReturnValue(read.promise);
    const m = await mount();

    expect(m.vm.loading).toBe(true);
    expect(m.vm.data.status).toBeNull();

    await act(async () => read.resolve(stored('ok')));

    expect(m.vm.loading).toBe(false);
    expect(m.vm.data.status).toBe('ok');
    await m.unmount();
  });

  /** Reading before the base URL and token arrive calls the default address with no token. */
  it('does not read until the pairing has loaded', async () => {
    server.hydrated = false;
    const m = await mount();

    expect(web.webSearchState).not.toHaveBeenCalled();
    await m.unmount();
  });
});

describe('saving a key', () => {
  it('sends the key trimmed, once, and takes the status from the Pond\'s answer', async () => {
    web.setWebSearchKey.mockResolvedValue({ configured: true, status: 'ok' });
    const m = await mount();
    await type(m, '  BSA-secret-key \n');

    let saved = false;
    await act(async () => {
      saved = await m.vm.actions.save();
    });

    expect(saved).toBe(true);
    expect(web.setWebSearchKey).toHaveBeenCalledTimes(1);
    expect(web.setWebSearchKey).toHaveBeenCalledWith('BSA-secret-key');
    expect(m.vm.data.status).toBe('ok');
    expect(m.vm.data.configured).toBe(true);
    // The answer is believed as it is: no second read to confirm it.
    expect(web.webSearchState).toHaveBeenCalledTimes(1);
    await m.unmount();
  });

  /** The field is write-only, so this is the whole of "never shown back". */
  it('empties the field the moment the Pond has the key', async () => {
    web.setWebSearchKey.mockResolvedValue({ configured: true, status: 'ok' });
    const m = await mount();
    await type(m, 'BSA-secret-key');
    expect(m.vm.data.draft).toBe('BSA-secret-key');

    await act(async () => {
      await m.vm.actions.save();
    });

    expect(m.vm.data.draft).toBe('');
    expect(m.vm.data.canSave).toBe(false);
    await m.unmount();
  });

  it('keeps the key nowhere once it is saved, in state, in a later read, or in a log', async () => {
    const logged = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    web.setWebSearchKey.mockResolvedValue({ configured: true, status: 'ok' });
    web.webSearchState.mockResolvedValue(stored('ok'));
    const key = 'BSA-never-keep-this-9f3c';
    const m = await mount();
    await type(m, key);

    await act(async () => {
      await m.vm.actions.save();
    });
    // A refresh, and a quiet poll, after the save: the answer to neither can bring it back.
    await act(async () => m.vm.actions.refresh());
    await act(async () => {
      await poll?.();
    });

    const everything = JSON.stringify({ ...m.vm, actions: undefined });
    expect(everything).not.toContain(key);
    for (const spy of logged) expect(JSON.stringify(spy.mock.calls)).not.toContain(key);
    logged.forEach((spy) => spy.mockRestore());
    await m.unmount();
  });

  it('keeps a key that failed to save out of every log, whichever way it failed', async () => {
    const logged = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    const key = 'BSA-failed-key-77ab';
    for (const failure of [refusal(422), refusal(503), refusal(401), new TypeError('Network request failed')]) {
      web.setWebSearchKey.mockRejectedValueOnce(failure);
      const m = await mount();
      await type(m, key);
      await act(async () => {
        await m.vm.actions.save();
      });
      await m.unmount();
    }

    for (const spy of logged) expect(JSON.stringify(spy.mock.calls)).not.toContain(key);
    logged.forEach((spy) => spy.mockRestore());
  });

  it('shows the Pond\'s refusal inline, as Brave\'s own sentence, and stores nothing', async () => {
    web.webSearchState.mockResolvedValue(stored('ok'));
    web.setWebSearchKey.mockRejectedValue(refusal(422, 'Brave did not accept this key.'));
    const m = await mount();
    await type(m, 'not-a-key');

    let saved = true;
    await act(async () => {
      saved = await m.vm.actions.save();
    });

    expect(saved).toBe(false);
    expect(m.vm.keyError).toBe('Brave did not accept this key.');
    // The key already stored is untouched by a refusal of the one that was typed over it.
    expect(m.vm.data.status).toBe('ok');
    expect(m.vm.data.configured).toBe(true);
    await m.unmount();
  });

  /** The sentence is the catalogue's, not whatever the Pond happened to put in `error`. */
  it('does not show the Pond\'s own wording for a 422', async () => {
    web.setWebSearchKey.mockRejectedValue(refusal(422, 'key rejected upstream (HTTP 401)'));
    const m = await mount();
    await type(m, 'not-a-key');

    await act(async () => {
      await m.vm.actions.save();
    });

    expect(m.vm.keyError).toBe('Brave did not accept this key.');
    await m.unmount();
  });

  it('keeps a refused key in the field so a typo can be fixed, and drops the complaint when it is', async () => {
    web.setWebSearchKey.mockRejectedValue(refusal(422));
    const m = await mount();
    await type(m, 'BSA-typo');
    await act(async () => {
      await m.vm.actions.save();
    });

    expect(m.vm.data.draft).toBe('BSA-typo');
    expect(m.vm.data.canSave).toBe(true);
    expect(m.vm.keyError).not.toBeNull();

    await type(m, 'BSA-typo-fixed');

    expect(m.vm.keyError).toBeNull();
    await m.unmount();
  });

  it.each<[string, unknown, string]>([
    ['a busy Pond', refusal(503), 'Your Pond is busy. Try again in a moment.'],
    ['a rate limit', refusal(429), 'Your Pond is busy. Try again in a moment.'],
    // The connection banner says a 401 already, and an action just taken must still not be silent.
    ['a refused session', refusal(401), 'Your Pond could not complete that request.'],
    ['no answer at all', new TypeError('Network request failed'), 'Your Pond could not complete that request.'],
  ])('says so, in words, on %s', async (_name, failure, sentence) => {
    web.setWebSearchKey.mockRejectedValue(failure);
    const m = await mount();
    await type(m, 'BSA-key');

    let saved = true;
    await act(async () => {
      saved = await m.vm.actions.save();
    });

    expect(saved).toBe(false);
    expect(m.vm.keyError).toBe(sentence);
    // Neither a status code nor the request line reaches the screen.
    expect(m.vm.keyError).not.toMatch(/\d{3}|PUT|web-search/);
    expect(m.vm.data.draft).toBe('BSA-key');
    await m.unmount();
  });

  it.each<WebSearchStatus>(['quota', 'unverified'])('takes a saved key\'s status as %s', async (status) => {
    web.setWebSearchKey.mockResolvedValue({ configured: true, status });
    const m = await mount();
    await type(m, 'BSA-key');

    await act(async () => {
      await m.vm.actions.save();
    });

    expect(m.vm.data.status).toBe(status);
    expect(m.vm.data.configured).toBe(true);
    expect(m.vm.data.draft).toBe('');
    await m.unmount();
  });

  it('sends nothing for an empty or blank field', async () => {
    const m = await mount();
    expect(m.vm.data.canSave).toBe(false);

    await type(m, '   \n ');
    expect(m.vm.data.canSave).toBe(false);
    let saved = true;
    await act(async () => {
      saved = await m.vm.actions.save();
    });

    expect(saved).toBe(false);
    expect(web.setWebSearchKey).not.toHaveBeenCalled();
    await m.unmount();
  });

  /** The Pond checks the key with Brave, so a second tap is a second request on the household's quota. */
  it('does not send a second request while the first is out', async () => {
    const out = deferred<{ configured: boolean; status: WebSearchStatus }>();
    web.setWebSearchKey.mockReturnValue(out.promise);
    const m = await mount();
    await type(m, 'BSA-key');

    let first!: Promise<boolean>;
    await act(async () => {
      first = m.vm.actions.save();
    });
    expect(m.vm.saving).toBe(true);
    expect(m.vm.data.canSave).toBe(false);

    await act(async () => {
      await m.vm.actions.save();
    });
    expect(web.setWebSearchKey).toHaveBeenCalledTimes(1);

    await act(async () => {
      out.resolve({ configured: true, status: 'ok' });
      await first;
    });
    expect(m.vm.saving).toBe(false);
    await m.unmount();
  });
});

describe('removing the key', () => {
  it('asks the Pond, then reads the status as off', async () => {
    web.webSearchState.mockResolvedValue(stored('ok'));
    web.removeWebSearchKey.mockResolvedValue(undefined);
    const m = await mount();

    let removed = false;
    await act(async () => {
      removed = await m.vm.actions.remove();
    });

    expect(removed).toBe(true);
    expect(web.removeWebSearchKey).toHaveBeenCalledTimes(1);
    expect(m.vm.data.status).toBe('not_configured');
    expect(m.vm.data.configured).toBe(false);
    await m.unmount();
  });

  it('removes a key that Brave refused too', async () => {
    web.webSearchState.mockResolvedValue(stored('rejected'));
    web.removeWebSearchKey.mockResolvedValue(undefined);
    const m = await mount();
    expect(m.vm.data.configured).toBe(true);

    await act(async () => {
      await m.vm.actions.remove();
    });

    expect(m.vm.data.configured).toBe(false);
    await m.unmount();
  });

  /** A refused removal must not look done: the household would think Goose had stopped searching. */
  it('leaves the key standing, and says so, when the Pond refuses', async () => {
    web.webSearchState.mockResolvedValue(stored('ok'));
    web.removeWebSearchKey.mockRejectedValue(refusal(500));
    const m = await mount();

    let removed = true;
    await act(async () => {
      removed = await m.vm.actions.remove();
    });

    expect(removed).toBe(false);
    expect(m.vm.data.configured).toBe(true);
    expect(m.vm.data.status).toBe('ok');
    expect(m.vm.error).toBe('Your Pond is busy. Try again in a moment.');
    await m.unmount();
  });

  it('does not remove while a save is out', async () => {
    const out = deferred<{ configured: boolean; status: WebSearchStatus }>();
    web.setWebSearchKey.mockReturnValue(out.promise);
    const m = await mount();
    await type(m, 'BSA-key');
    let saving!: Promise<boolean>;
    await act(async () => {
      saving = m.vm.actions.save();
    });

    await act(async () => {
      await m.vm.actions.remove();
    });
    expect(web.removeWebSearchKey).not.toHaveBeenCalled();

    await act(async () => {
      out.resolve({ configured: true, status: 'ok' });
      await saving;
    });
    await m.unmount();
  });
});

describe('when the read does not go to plan', () => {
  /** An older Pond has no route. "Update your Pond" is the honest answer, not "unreachable". */
  it('tells a Pond that predates web search apart from one that cannot be reached', async () => {
    web.webSearchState.mockRejectedValue(refusal(404));
    const m = await mount();

    expect(m.vm.unsupported).toBe(true);
    expect(m.vm.failed).toBe(false);
    expect(m.vm.error).toBeNull();
    expect(m.vm.data.status).toBeNull();
    expect(m.vm.loading).toBe(false);
    await m.unmount();
  });

  it('calls a first read that failed unknown, not off, and recovers on the next', async () => {
    web.webSearchState.mockRejectedValueOnce(refusal(503));
    const m = await mount();

    expect(m.vm.failed).toBe(true);
    expect(m.vm.error).toBe('Your Pond is busy. Try again in a moment.');
    expect(m.vm.data.status).toBeNull();

    web.webSearchState.mockResolvedValue(stored('ok'));
    await act(async () => m.vm.actions.refresh());

    expect(m.vm.failed).toBe(false);
    expect(m.vm.error).toBeNull();
    expect(m.vm.data.status).toBe('ok');
    await m.unmount();
  });

  it('keeps the last status when a quiet poll fails after one has loaded', async () => {
    web.webSearchState.mockResolvedValueOnce(stored('ok'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = await mount();

    web.webSearchState.mockRejectedValue(refusal(503));
    await act(async () => {
      await poll?.();
    });

    expect(m.vm.data.status).toBe('ok');
    expect(m.vm.failed).toBe(false);
    expect(m.vm.error).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    await m.unmount();
  });

  it('shows a status that changed on the Pond since the screen opened', async () => {
    web.webSearchState.mockResolvedValueOnce(stored('ok'));
    const m = await mount();
    expect(m.vm.data.status).toBe('ok');

    // Brave refused a search made in a conversation while this screen was open.
    web.webSearchState.mockResolvedValue(stored('rejected'));
    await act(async () => {
      await poll?.();
    });

    expect(m.vm.data.status).toBe('rejected');
    await m.unmount();
  });

  /** A read that was already out when the key was saved describes the Pond from before it. */
  it('does not let a read that started before a save undo it', async () => {
    const slow = deferred<WebSearchState>();
    web.webSearchState.mockResolvedValueOnce(OFF).mockReturnValueOnce(slow.promise);
    web.setWebSearchKey.mockResolvedValue({ configured: true, status: 'ok' });
    const m = await mount();

    let reading!: Promise<void>;
    await act(async () => {
      reading = m.vm.actions.refresh();
    });
    await type(m, 'BSA-key');
    await act(async () => {
      await m.vm.actions.save();
    });
    expect(m.vm.data.status).toBe('ok');

    await act(async () => {
      slow.resolve(OFF);
      await reading;
    });

    expect(m.vm.data.status).toBe('ok');
    expect(m.vm.data.configured).toBe(true);
    await m.unmount();
  });

  it('marks a pull to refresh over a status already on screen, rather than a first load', async () => {
    web.webSearchState.mockResolvedValueOnce(stored('ok'));
    const m = await mount();
    const again = deferred<WebSearchState>();
    web.webSearchState.mockReturnValue(again.promise);

    let reading!: Promise<void>;
    await act(async () => {
      reading = m.vm.actions.refresh();
    });

    expect(m.vm.refreshing).toBe(true);
    expect(m.vm.loading).toBe(false);

    await act(async () => {
      again.resolve(stored('ok'));
      await reading;
    });
    expect(m.vm.refreshing).toBe(false);
    await m.unmount();
  });
});

describe('the Developer toggle on mock', () => {
  beforeEach(() => {
    server.real = false;
  });

  it('never reaches the Pond', async () => {
    const m = await mount();
    await type(m, 'anything');
    await act(async () => {
      await m.vm.actions.save();
    });
    await act(async () => {
      await m.vm.actions.remove();
    });

    expect(web.webSearchState).not.toHaveBeenCalled();
    expect(web.setWebSearchKey).not.toHaveBeenCalled();
    expect(web.removeWebSearchKey).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('starts with no key, and saves, checks and removes one like the Pond does', async () => {
    const m = await mount();
    expect(m.vm.data.status).toBe('not_configured');
    expect(m.vm.data.configured).toBe(false);

    await type(m, 'a-working-key');
    await act(async () => {
      await m.vm.actions.save();
    });
    expect(m.vm.data.status).toBe('ok');
    expect(m.vm.data.configured).toBe(true);
    expect(m.vm.data.draft).toBe('');

    await act(async () => {
      await m.vm.actions.remove();
    });
    expect(m.vm.data.status).toBe('not_configured');
    expect(m.vm.data.configured).toBe(false);
    await m.unmount();
  });

  /** Every state the screen can show is one typed word away, so none needs a Pond to be looked at. */
  it.each<[string, WebSearchStatus]>([
    ['quota', 'quota'],
    ['offline', 'unverified'],
    ['  QUOTA ', 'quota'],
  ])('reaches %s by typing it', async (word, status) => {
    const m = await mount();
    await type(m, word);

    await act(async () => {
      await m.vm.actions.save();
    });

    expect(m.vm.data.status).toBe(status);
    await m.unmount();
  });

  it('refuses the key "invalid" the way the Pond refuses a key Brave rejects', async () => {
    const m = await mount();
    await type(m, 'invalid');

    let saved = true;
    await act(async () => {
      saved = await m.vm.actions.save();
    });

    expect(saved).toBe(false);
    expect(m.vm.keyError).toBe('Brave did not accept this key.');
    expect(m.vm.data.configured).toBe(false);
    expect(m.vm.data.draft).toBe('invalid');
    await m.unmount();
  });
});

describe('nearby places', () => {
  /** The copy is the hand-off's, pinned in full: it says exactly what leaves the house. */
  it('reads the switch and the town from the Pond, and says what the town is before it is turned', async () => {
    web.webSearchState.mockResolvedValue(withNearby(false, 'Nairobi'));
    const m = await mount();

    expect(m.vm.data.nearby).toEqual({ enabled: false, town: 'Nairobi' });
    expect(m.vm.data.canToggleNearby).toBe(true);
    expect(nearbyNote(m.vm.data.nearby, i18n.t)).toBe(
      'Sends your town (Nairobi) to Brave with each search, so it can find places near you. Your exact location is never sent.',
    );
    await m.unmount();
  });

  it('saves only its own setting through the settings route, and shows it on', async () => {
    web.webSearchState.mockResolvedValue(withNearby(false, 'Nairobi'));
    web.updateSettings.mockResolvedValue({ web_search_local_results: true } as never);
    const m = await mount();

    let kept!: boolean;
    await act(async () => {
      kept = await m.vm.actions.setNearby(true);
    });

    expect(kept).toBe(true);
    expect(web.updateSettings).toHaveBeenCalledTimes(1);
    expect(web.updateSettings).toHaveBeenCalledWith({ web_search_local_results: true });
    expect(m.vm.data.nearby).toEqual({ enabled: true, town: 'Nairobi' });
    expect(m.vm.nearbyError).toBeNull();
    await m.unmount();
  });

  it('cannot turn on with no town, and says to set the location first', async () => {
    web.webSearchState.mockResolvedValue(withNearby(false, null));
    const m = await mount();

    expect(m.vm.data.canToggleNearby).toBe(false);
    let kept!: boolean;
    await act(async () => {
      kept = await m.vm.actions.setNearby(true);
    });

    expect(kept).toBe(false);
    expect(web.updateSettings).not.toHaveBeenCalled();
    expect(m.vm.data.nearby?.enabled).toBe(false);
    expect(nearbyNote(m.vm.data.nearby, i18n.t)).toBe(
      'Needs your location first. Set it under Your home, then come back to turn this on.',
    );
    await m.unmount();
  });

  it('can still be turned off when it was left on with no town, and says no town is sent', async () => {
    web.webSearchState.mockResolvedValue(withNearby(true, null));
    web.updateSettings.mockResolvedValue({ web_search_local_results: false } as never);
    const m = await mount();

    expect(nearbyNote(m.vm.data.nearby, i18n.t)).toBe(
      'Your location is not set, so no town is sent. Set it under Your home.',
    );
    expect(m.vm.data.canToggleNearby).toBe(true);
    await act(async () => {
      await m.vm.actions.setNearby(false);
    });

    expect(web.updateSettings).toHaveBeenCalledWith({ web_search_local_results: false });
    expect(m.vm.data.nearby?.enabled).toBe(false);
    await m.unmount();
  });

  it('keeps the switch off, and says why, on a Pond that predates nearby places', async () => {
    web.webSearchState.mockResolvedValue(stored('ok'));
    const m = await mount();

    expect(m.vm.data.nearby).toBeNull();
    expect(m.vm.data.nearbyUnsupported).toBe(true);
    expect(m.vm.data.canToggleNearby).toBe(false);
    expect(nearbyNote(m.vm.data.nearby, i18n.t)).toBe(
      'This Pond cannot look for nearby places yet. Update it, then open this screen again.',
    );
    let kept!: boolean;
    await act(async () => {
      kept = await m.vm.actions.setNearby(true);
    });
    expect(kept).toBe(false);
    expect(web.updateSettings).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('is neither on nor unsupported before the Pond has answered', async () => {
    web.webSearchState.mockReturnValue(deferred<WebSearchState>().promise);
    const m = await mount();

    expect(m.vm.data.nearby).toBeNull();
    expect(m.vm.data.nearbyUnsupported).toBe(false);
    await m.unmount();
  });

  it('goes back, and says so, when the Pond does not save it', async () => {
    web.webSearchState.mockResolvedValue(withNearby(false, 'Nairobi'));
    web.updateSettings.mockRejectedValue(new ApiError('PUT /api/v1/settings → 500', 500, null, null));
    const m = await mount();

    let kept!: boolean;
    await act(async () => {
      kept = await m.vm.actions.setNearby(true);
    });

    expect(kept).toBe(false);
    expect(m.vm.data.nearby?.enabled).toBe(false);
    expect(m.vm.nearbyError).toBe('Could not save this setting. Try again in a moment.');
    await m.unmount();
  });

  it('shows the change while it saves, and takes no second one meanwhile', async () => {
    web.webSearchState.mockResolvedValue(withNearby(false, 'Nairobi'));
    const pending = deferred<never>();
    web.updateSettings.mockReturnValue(pending.promise);
    const m = await mount();

    let first!: Promise<boolean>;
    await act(async () => {
      first = m.vm.actions.setNearby(true);
    });
    expect(m.vm.data.nearby?.enabled).toBe(true);
    expect(m.vm.nearbySaving).toBe(true);
    expect(m.vm.data.canToggleNearby).toBe(false);

    await act(async () => {
      await m.vm.actions.setNearby(false);
    });
    expect(web.updateSettings).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ web_search_local_results: true } as never);
      await first;
    });
    expect(m.vm.data.nearby?.enabled).toBe(true);
    expect(m.vm.nearbySaving).toBe(false);
    await m.unmount();
  });

  it('shows what the Pond stored when it answers otherwise, and the change as made when it does not say', async () => {
    web.webSearchState.mockResolvedValue(withNearby(false, 'Nairobi'));
    web.updateSettings.mockResolvedValueOnce({ web_search_local_results: false } as never);
    const m = await mount();

    let kept!: boolean;
    await act(async () => {
      kept = await m.vm.actions.setNearby(true);
    });
    expect(kept).toBe(false);
    expect(m.vm.data.nearby?.enabled).toBe(false);

    // `request` hands back undefined for an empty body.
    web.updateSettings.mockResolvedValueOnce(undefined as never);
    await act(async () => {
      kept = await m.vm.actions.setNearby(true);
    });
    expect(kept).toBe(true);
    expect(m.vm.data.nearby?.enabled).toBe(true);
    await m.unmount();
  });

  it('does not let a read that started before the change undo it', async () => {
    const slow = deferred<WebSearchState>();
    web.webSearchState.mockResolvedValueOnce(withNearby(false, 'Nairobi')).mockReturnValueOnce(slow.promise);
    web.updateSettings.mockResolvedValue({ web_search_local_results: true } as never);
    const m = await mount();

    let reading!: Promise<void>;
    await act(async () => {
      reading = m.vm.actions.refresh();
    });
    await act(async () => {
      await m.vm.actions.setNearby(true);
    });
    await act(async () => {
      slow.resolve(withNearby(false, 'Nairobi'));
      await reading;
    });

    expect(m.vm.data.nearby?.enabled).toBe(true);
    await m.unmount();
  });

  it('is left alone when the key is saved or removed', async () => {
    web.webSearchState.mockResolvedValue(withNearby(true, 'Nairobi', stored('ok')));
    web.setWebSearchKey.mockResolvedValue({ configured: true, status: 'ok' });
    web.removeWebSearchKey.mockResolvedValue(undefined);
    const m = await mount();

    await type(m, 'BSA-key');
    await act(async () => {
      await m.vm.actions.save();
    });
    expect(m.vm.data.nearby).toEqual({ enabled: true, town: 'Nairobi' });

    await act(async () => {
      await m.vm.actions.remove();
    });
    expect(m.vm.data.nearby).toEqual({ enabled: true, town: 'Nairobi' });
    await m.unmount();
  });

  it('turns on and off on mock without reaching the Pond', async () => {
    server.real = false;
    const m = await mount();

    expect(m.vm.data.nearby).toEqual({ enabled: false, town: 'Nairobi' });
    await act(async () => {
      await m.vm.actions.setNearby(true);
    });
    expect(m.vm.data.nearby?.enabled).toBe(true);
    expect(web.updateSettings).not.toHaveBeenCalled();
    await m.unmount();
  });
});

describe('Brave\'s dashboard', () => {
  it('opens in the in-app browser, at the address the help text names', async () => {
    const m = await mount();

    act(() => m.vm.actions.openDashboard());

    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://api-dashboard.search.brave.com');
    expect(BRAVE_DASHBOARD_URL).toBe('https://api-dashboard.search.brave.com');
    await m.unmount();
  });

  it('does not take the screen down when the browser will not open', async () => {
    jest.mocked(WebBrowser.openBrowserAsync).mockRejectedValue(new Error('no browser'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = await mount();

    await act(async () => m.vm.actions.openDashboard());

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    await m.unmount();
  });
});
