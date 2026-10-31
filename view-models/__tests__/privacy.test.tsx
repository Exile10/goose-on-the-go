/**
 * The privacy screen names the town web search sends, and only while the Pond says one is sent.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import i18n from '@/services/i18n';
import { api } from '@/services/api-client';
import type { WebSearchState } from '@/services/types';
import { usePrivacy, type UsePrivacy } from '@/view-models/use-privacy';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { webSearchState: jest.fn() } };
});

const server = { hydrated: true, real: true };
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: server.hydrated, isScreenReal: () => server.real }),
}));

const pond = jest.mocked(api);
const answer = (enabled: boolean, town: string | null): WebSearchState => ({
  provider: 'brave',
  configured: true,
  status: 'ok',
  local_results: { enabled, town },
});

async function townShown(): Promise<string | null> {
  let latest!: UsePrivacy;
  const Probe = () => {
    latest = usePrivacy();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  const town = latest.data.nearbyTown;
  await act(async () => tree.unmount());
  return town;
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.resetAllMocks();
  server.hydrated = true;
  server.real = true;
});

describe('the town on the privacy screen', () => {
  it('names the town while nearby places is on', async () => {
    pond.webSearchState.mockResolvedValue(answer(true, 'Nairobi'));
    expect(await townShown()).toBe('Nairobi');
    expect(i18n.t('webSearch.townSentence', { town: 'Nairobi' })).toBe(
      'Each web search sends Nairobi to Brave, so the results can include places near you.',
    );
  });

  it('names none while it is off, with no town, or from a Pond that predates it', async () => {
    pond.webSearchState.mockResolvedValue(answer(false, 'Nairobi'));
    expect(await townShown()).toBeNull();
    pond.webSearchState.mockResolvedValue(answer(true, null));
    expect(await townShown()).toBeNull();
    pond.webSearchState.mockResolvedValue({ provider: 'brave', configured: true, status: 'ok' });
    expect(await townShown()).toBeNull();
  });

  it('leaves the fixed copy alone when the Pond cannot be read', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    pond.webSearchState.mockRejectedValue(new TypeError('Network request failed'));
    expect(await townShown()).toBeNull();
    warn.mockRestore();
  });

  it('does not read before the pairing has loaded, or on mock', async () => {
    server.hydrated = false;
    expect(await townShown()).toBeNull();
    server.hydrated = true;
    server.real = false;
    expect(await townShown()).toBeNull();
    expect(pond.webSearchState).not.toHaveBeenCalled();
  });

  /** The fixed copy is true whatever the switch says, so it never depends on the read. */
  it('says in the fixed copy that nearby places sends the town and never the exact location', () => {
    expect(i18n.t('privacy.networkBody')).toContain(
      'If you turn on nearby places, each search also sends your town, never your exact location.',
    );
  });
});
