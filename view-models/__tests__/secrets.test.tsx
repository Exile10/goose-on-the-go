/**
 * The Secrets view-model: the listing and its friendly names, what Add, Replace and Delete send and
 * leave on screen, and what each refusal says.
 *
 * The thing this screen must never do is hold on to a value. The Pond never sends one back, so the
 * only copy the app ever has is what was typed, and it has to be gone once it is submitted, whether
 * the Pond kept it or not. Those tests look for the value anywhere in the view-model's output, and
 * in everything logged, rather than only in the field it is supposed to have left.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { secretLabelKey, isValidSecretKey } from '@/models/secrets';
import { ApiError, api } from '@/services/api-client';
import { currentSnackbar, resetSnackbar } from '@/services/snackbar';
import { useSecrets, type UseSecrets } from '@/view-models/use-secrets';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: { listSecretKeys: jest.fn(), setSecret: jest.fn(), deleteSecret: jest.fn() },
  };
});

jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: true }),
}));

// The poll is `use-live.test.ts`'s business. Here it is a read on mount.
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

const VALUE = 'sk-live-0123456789abcdef';

const refusal = (status: number, body: unknown = null) =>
  new ApiError(`PUT /api/v1/secrets/K → ${status}`, status, null, null, body);

interface Mounted {
  readonly vm: UseSecrets;
  unmount: () => Promise<void>;
}

async function mount(): Promise<Mounted> {
  let latest!: UseSecrets;
  const Probe = () => {
    latest = useSecrets();
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

/** Everything the view-model hands the screen, as text, so a value anywhere in it is found. */
function everything(vm: UseSecrets): string {
  const { actions: _actions, ...rest } = vm;
  return JSON.stringify(rest);
}

let warn: jest.SpyInstance;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  resetSnackbar();
  jest.resetAllMocks();
  pond.listSecretKeys.mockResolvedValue(['SPOTIFY_CLIENT_ID', 'MY_KEY']);
  pond.setSecret.mockResolvedValue({ restarted: [], restartFailed: [] });
  pond.deleteSecret.mockResolvedValue(undefined);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

/** Nothing logged may carry the value. */
function expectValueNeverLogged() {
  expect(JSON.stringify(warn.mock.calls)).not.toContain(VALUE);
}

describe('the listing', () => {
  it('sorts the names and gives the known ones their friendly name', async () => {
    const m = await mount();

    expect(m.vm.loading).toBe(false);
    expect(m.vm.data.keys).toEqual([
      { key: 'MY_KEY', labelKey: null },
      { key: 'SPOTIFY_CLIENT_ID', labelKey: 'secrets.known.spotifyClientId' },
    ]);
    await m.unmount();
  });

  it('names the keys the Pond catalogue and services store', () => {
    expect(secretLabelKey('BRAVE_SEARCH_API_KEY')).toBe('secrets.known.braveWebSearch');
    expect(secretLabelKey('BRAVE_API_KEY')).toBe('secrets.known.braveExtension');
    expect(secretLabelKey('GITHUB_PERSONAL_ACCESS_TOKEN')).toBe('secrets.known.github');
    expect(secretLabelKey('toString')).toBeNull();
    expect(secretLabelKey('SOMETHING_ELSE')).toBeNull();
  });

  it('says it could not read the list, rather than showing it empty', async () => {
    pond.listSecretKeys.mockRejectedValue(new TypeError('Network request failed'));
    const m = await mount();

    expect(m.vm.failed).toBe(true);
    expect(m.vm.data.keys).toEqual([]);
    await m.unmount();
  });

  it('says in words when the secret storage is not there', async () => {
    pond.listSecretKeys.mockRejectedValue(new ApiError('GET → 503', 503, null));
    const m = await mount();

    expect(m.vm.error).toBe("Your Pond's secret storage is not available right now.");
    await m.unmount();
  });
});

describe('adding a secret', () => {
  it('sends the key and value, adds the row, and says so', async () => {
    const m = await mount();
    await act(async () => m.vm.actions.startAdd());
    await act(async () => m.vm.actions.setDraftKey(' NEW_KEY '));
    await act(async () => m.vm.actions.setDraftValue(VALUE));
    expect(m.vm.data.canSave).toBe(true);

    let saved = false;
    await act(async () => {
      saved = await m.vm.actions.save();
    });

    expect(saved).toBe(true);
    expect(pond.setSecret).toHaveBeenCalledWith('NEW_KEY', VALUE);
    expect(m.vm.data.keys.map((r) => r.key)).toEqual(['MY_KEY', 'NEW_KEY', 'SPOTIFY_CLIENT_ID']);
    expect(m.vm.data.form).toBeNull();
    expect(currentSnackbar()).toMatchObject({ tone: 'neutral', message: 'NEW_KEY is saved on your Pond.' });
    await m.unmount();
  });

  it('does not retain the value after a save the Pond accepted', async () => {
    const m = await mount();
    await act(async () => m.vm.actions.startAdd());
    await act(async () => m.vm.actions.setDraftKey('NEW_KEY'));
    await act(async () => m.vm.actions.setDraftValue(VALUE));
    await act(async () => {
      await m.vm.actions.save();
    });

    expect(m.vm.data.draftValue).toBe('');
    expect(everything(m.vm)).not.toContain(VALUE);
    expectValueNeverLogged();
    await m.unmount();
  });

  it('does not retain the value after a save the Pond refused, and says why', async () => {
    pond.setSecret.mockRejectedValue(refusal(500));
    const m = await mount();
    await act(async () => m.vm.actions.startAdd());
    await act(async () => m.vm.actions.setDraftKey('NEW_KEY'));
    await act(async () => m.vm.actions.setDraftValue(VALUE));

    let saved = true;
    await act(async () => {
      saved = await m.vm.actions.save();
    });

    expect(saved).toBe(false);
    expect(m.vm.formError).toBe('Your Pond is busy. Try again in a moment.');
    expect(m.vm.data.form).toEqual({ kind: 'add' });
    expect(m.vm.data.draftKey).toBe('NEW_KEY');
    expect(m.vm.data.draftValue).toBe('');
    expect(everything(m.vm)).not.toContain(VALUE);
    expectValueNeverLogged();
    await m.unmount();
  });

  it('empties the value field while the request is still out', async () => {
    let finish!: () => void;
    pond.setSecret.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({ restarted: [], restartFailed: [] });
      }),
    );
    const m = await mount();
    await act(async () => m.vm.actions.startAdd());
    await act(async () => m.vm.actions.setDraftKey('NEW_KEY'));
    await act(async () => m.vm.actions.setDraftValue(VALUE));

    let pending!: Promise<boolean>;
    await act(async () => {
      pending = m.vm.actions.save();
    });
    expect(m.vm.saving).toBe(true);
    expect(everything(m.vm)).not.toContain(VALUE);

    await act(async () => {
      finish();
      await pending;
    });
    await m.unmount();
  });

  it('refuses a key name that is not one, without sending anything', async () => {
    const m = await mount();
    await act(async () => m.vm.actions.startAdd());
    await act(async () => m.vm.actions.setDraftKey('has space'));
    await act(async () => m.vm.actions.setDraftValue(VALUE));
    await act(async () => {
      await m.vm.actions.save();
    });

    expect(pond.setSecret).not.toHaveBeenCalled();
    expect(m.vm.formError).toMatch(/starts with a letter/);
    expect(isValidSecretKey('A_KEY.v2-x')).toBe(true);
    expect(isValidSecretKey('9KEY')).toBe(false);
    await m.unmount();
  });

  it('will not overwrite a stored key from Add', async () => {
    const m = await mount();
    await act(async () => m.vm.actions.startAdd());
    await act(async () => m.vm.actions.setDraftKey('MY_KEY'));
    await act(async () => m.vm.actions.setDraftValue(VALUE));
    await act(async () => {
      await m.vm.actions.save();
    });

    expect(pond.setSecret).not.toHaveBeenCalled();
    expect(m.vm.formError).toBe('Your Pond already holds this key. Use Replace on it instead.');
    await m.unmount();
  });

  it("says where a member's Uber key is managed when the Pond refuses it", async () => {
    pond.setSecret.mockRejectedValue(refusal(403, { error: 'reserved', code: 'secret_reserved' }));
    const m = await mount();
    await act(async () => m.vm.actions.startAdd());
    await act(async () => m.vm.actions.setDraftKey('UBER_TOKENS_ALICE'));
    await act(async () => m.vm.actions.setDraftValue(VALUE));
    await act(async () => {
      await m.vm.actions.save();
    });

    expect(m.vm.formError).toBe(
      'Uber sign-ins belong to each member, and are managed only on the Pond itself, under Settings, Accounts.',
    );
    await m.unmount();
  });

  it('says plainly that any other 403 was a refusal, rather than saying nothing', async () => {
    pond.setSecret.mockRejectedValue(refusal(403, { error: 'forbidden' }));
    const m = await mount();
    await act(async () => m.vm.actions.startAdd());
    await act(async () => m.vm.actions.setDraftKey('NEW_KEY'));
    await act(async () => m.vm.actions.setDraftValue(VALUE));
    await act(async () => {
      await m.vm.actions.save();
    });

    expect(m.vm.formError).toBe('Your Pond refused this from this phone.');
    await m.unmount();
  });
});

describe('replacing a value', () => {
  it('sends the new value under the existing key, and never had the old one', async () => {
    const m = await mount();
    await act(async () => m.vm.actions.startReplace('SPOTIFY_CLIENT_ID'));
    expect(m.vm.data.form).toEqual({ kind: 'replace', key: 'SPOTIFY_CLIENT_ID' });
    expect(m.vm.data.draftValue).toBe('');

    await act(async () => m.vm.actions.setDraftValue(VALUE));
    await act(async () => {
      await m.vm.actions.save();
    });

    expect(pond.setSecret).toHaveBeenCalledWith('SPOTIFY_CLIENT_ID', VALUE);
    expect(currentSnackbar()).toMatchObject({ tone: 'neutral', message: 'Spotify client ID is saved on your Pond.' });
    expect(everything(m.vm)).not.toContain(VALUE);
    await m.unmount();
  });

  it('names the extensions that could not restart to use it', async () => {
    pond.setSecret.mockResolvedValue({ restarted: [], restartFailed: ['music'] });
    const m = await mount();
    await act(async () => m.vm.actions.startReplace('SPOTIFY_CLIENT_ID'));
    await act(async () => m.vm.actions.setDraftValue(VALUE));
    await act(async () => {
      await m.vm.actions.save();
    });

    expect(currentSnackbar()).toMatchObject({
      tone: 'danger',
      message: 'Spotify client ID is saved, but these extensions could not restart to use it: music.',
    });
    await m.unmount();
  });

  it('drops what was typed when the form is cancelled', async () => {
    const m = await mount();
    await act(async () => m.vm.actions.startReplace('MY_KEY'));
    await act(async () => m.vm.actions.setDraftValue(VALUE));
    await act(async () => m.vm.actions.cancel());

    expect(m.vm.data.form).toBeNull();
    expect(everything(m.vm)).not.toContain(VALUE);
    expect(pond.setSecret).not.toHaveBeenCalled();
    await m.unmount();
  });
});

describe('deleting a secret', () => {
  it('removes the row once the Pond says it is gone', async () => {
    const m = await mount();
    let gone = false;
    await act(async () => {
      gone = await m.vm.actions.remove('MY_KEY');
    });

    expect(gone).toBe(true);
    expect(pond.deleteSecret).toHaveBeenCalledWith('MY_KEY');
    expect(m.vm.data.keys.map((r) => r.key)).toEqual(['SPOTIFY_CLIENT_ID']);
    expect(currentSnackbar()).toMatchObject({ tone: 'neutral', message: 'MY_KEY is deleted from your Pond.' });
    await m.unmount();
  });

  it('keeps the row and says so when the deletion is refused', async () => {
    pond.deleteSecret.mockRejectedValue(refusal(403, { code: 'secret_reserved' }));
    const m = await mount();
    let gone = true;
    await act(async () => {
      gone = await m.vm.actions.remove('MY_KEY');
    });

    expect(gone).toBe(false);
    expect(m.vm.data.keys.map((r) => r.key)).toEqual(['MY_KEY', 'SPOTIFY_CLIENT_ID']);
    expect(m.vm.error).toBeNull();
    expect(currentSnackbar()?.tone).toBe('danger');
    expect(currentSnackbar()?.message).toMatch(/managed only on the Pond itself/);
    // The Pond decided; asking again would get the same answer.
    expect(currentSnackbar()?.action).toBeUndefined();
    await m.unmount();
  });

  it('offers Try again when the deletion failed for a reason that may pass', async () => {
    pond.deleteSecret.mockRejectedValueOnce(refusal(500)).mockResolvedValueOnce();
    const m = await mount();
    await act(async () => {
      await m.vm.actions.remove('MY_KEY');
    });
    expect(currentSnackbar()?.tone).toBe('danger');
    await act(async () => currentSnackbar()?.action?.onPress());
    expect(pond.deleteSecret).toHaveBeenCalledTimes(2);
    expect(m.vm.data.keys.map((r) => r.key)).toEqual(['SPOTIFY_CLIENT_ID']);
    await m.unmount();
  });
});
