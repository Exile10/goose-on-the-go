/**
 * Signing an installed extension in, from the Extensions screen: what the person is told for each
 * way it can end, and that a connected sign-in re-reads the list so its status shows.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { currentSnackbar, resetSnackbar } from '@/services/snackbar';
import type { SecretRequirement } from '@/services/types';
import { signInExtension } from '@/view-models/extension-sign-in';
import { useExtensions, type UseExtensions } from '@/view-models/use-extensions';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { listExtensions: jest.fn(), listMarketplace: jest.fn() } };
});
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true }) }));
jest.mock('../extension-sign-in', () => ({ signInExtension: jest.fn() }));

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
const signIn = jest.mocked(signInExtension);
const spotify: SecretRequirement = { key: 'SPOTIFY_TOKEN', display_name: 'Spotify', description: '', required: true, kind: 'oauth_flow' };

async function mount() {
  let latest!: UseExtensions;
  const Probe = () => {
    latest = useExtensions();
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
  jest.clearAllMocks();
  resetSnackbar();
  pond.listExtensions.mockResolvedValue([]);
  pond.listMarketplace.mockResolvedValue([]);
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

it('says it is connected and reads the list again', async () => {
  signIn.mockResolvedValue('connected');
  const m = await mount();
  const reads = pond.listExtensions.mock.calls.length;

  await act(async () => m.vm.actions.signIn('music', spotify));

  expect(signIn).toHaveBeenCalledWith('SPOTIFY_TOKEN', 'music');
  expect(currentSnackbar()).toMatchObject({ tone: 'success', message: i18n.t('extensions.signIn.connected', { name: 'Spotify' }) });
  expect(pond.listExtensions.mock.calls.length).toBe(reads + 1);
  await m.unmount();
});

it('points at the Pond computer when the sign-in never came back', async () => {
  signIn.mockResolvedValue('unfinished');
  const m = await mount();
  await act(async () => m.vm.actions.signIn('music', spotify));
  expect(currentSnackbar()).toMatchObject({ tone: 'danger', message: i18n.t('extensions.signIn.unfinished', { name: 'Spotify' }) });
  await m.unmount();
});

it('says the Pond needs a client ID when it refuses to start for want of one', async () => {
  signIn.mockRejectedValue(new ApiError('POST /api/v1/oauth/authorize → 400', 400, null, 'Add your Spotify client ID first.', {
    error: 'Add your Spotify client ID first.',
    code: 'client_id_missing',
  }));
  const m = await mount();
  await act(async () => m.vm.actions.signIn('music', spotify));
  expect(currentSnackbar()).toMatchObject({ tone: 'danger', message: i18n.t('extensions.signIn.clientIdMissing', { name: 'Spotify' }) });
  await m.unmount();
});
