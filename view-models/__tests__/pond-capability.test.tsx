/**
 * What the paired Pond said it can do (#168): kept with its pin, so another Pond's answer is never
 * read as this one's, and seen by a screen already open when a refresh says it again.
 */

import React from 'react';
import { act, create } from 'react-test-renderer';

import { capabilitiesFor, rememberCapabilities, resetCapabilitiesCache } from '@/services/pond-capabilities';
import { Storage } from '@/services/storage';
import { usePondCapability } from '@/view-models/use-pond-capability';

const server = { pairedPin: 'sha256/pond-a' as string | null };
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ pairedPin: server.pairedPin }),
}));

beforeEach(async () => {
  resetCapabilitiesCache();
  await Storage.set('pondCapabilities', '');
  server.pairedPin = 'sha256/pond-a';
});

describe('what a Pond said it can do', () => {
  it('is read back for that Pond only', async () => {
    await rememberCapabilities('sha256/pond-a', ['chat', 'routines']);
    expect(await capabilitiesFor('sha256/pond-a')).toEqual(['chat', 'routines']);
    expect(await capabilitiesFor('sha256/pond-b')).toBeNull();
  });

  it('outlives the app being closed', async () => {
    await rememberCapabilities('sha256/pond-a', ['routines']);
    resetCapabilitiesCache();
    expect(await capabilitiesFor('sha256/pond-a')).toEqual(['routines']);
  });

  it('keeps nothing from an answer without a list', async () => {
    await rememberCapabilities('sha256/pond-a', undefined);
    expect(await capabilitiesFor('sha256/pond-a')).toBeNull();
  });
});

describe('usePondCapability', () => {
  let seen: (boolean | null)[] = [];
  function Probe() {
    seen.push(usePondCapability('routines'));
    return null;
  }

  beforeEach(() => {
    seen = [];
  });

  it('is unknown until the Pond has said', async () => {
    await act(async () => {
      create(<Probe />);
    });
    expect(seen.at(-1)).toBeNull();
  });

  it('follows a refresh that says it while the screen is open', async () => {
    await act(async () => {
      create(<Probe />);
    });
    await act(async () => {
      await rememberCapabilities('sha256/pond-a', ['chat', 'routines']);
    });
    expect(seen.at(-1)).toBe(true);
  });

  it('is false when the Pond listed its capabilities without it', async () => {
    await rememberCapabilities('sha256/pond-a', ['chat']);
    await act(async () => {
      create(<Probe />);
    });
    expect(seen.at(-1)).toBe(false);
  });
});
