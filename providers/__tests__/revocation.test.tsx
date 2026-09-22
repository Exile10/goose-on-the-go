import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ServerProvider, useServer } from '../server-provider';
import { SecureStorage } from '@/services/secure-storage';
import { Storage } from '@/services/storage';
import { api } from '@/services/api-client';

jest.mock('@react-native-community/netinfo', () => ({
  configure: jest.fn(), addEventListener: jest.fn(() => () => undefined),
  fetch: jest.fn(async () => ({ type: 'wifi' })),
}));
jest.mock('@/services/storage', () => ({ Storage: { set: jest.fn(), remove: jest.fn(), getJSON: jest.fn(async () => null), setJSON: jest.fn() }, purgeLegacyStorage: jest.fn() }));
jest.mock('@/services/secure-storage', () => ({ SecureStorage: { set: jest.fn(), remove: jest.fn(), getJSON: jest.fn(async () => null), setJSON: jest.fn() } }));
jest.mock('@/services/pond-trust', () => ({ configurePondTrust: jest.fn(async () => undefined), PondTrustError: class extends Error {} }));
jest.mock('@/services/discovery', () => ({ findPondByHost: jest.fn(async () => null) }));
jest.mock('@/services/remote-access', () => ({
  cancelRemoteAccess: jest.fn(async () => undefined),
  restoreRemoteAccess: jest.fn(async () => undefined),
  resumeRemoteAccess: jest.fn(async () => false),
}));
jest.mock('@/services/api-client', () => ({
  api: {
    setRecovery: jest.fn(), setAuthRevoked: jest.fn(), setOnTokensRotated: jest.fn(),
    invalidateIdentity: jest.fn(), setBaseUrl: jest.fn(), setToken: jest.fn(), setRefreshToken: jest.fn(),
    handshakeRevoke: jest.fn(async () => undefined),
  },
  PondApiClient: jest.fn(() => ({ health: jest.fn(async () => ({ ok: true })) })),
  ApiError: class extends Error { status = 401 },
}));
jest.mock('@/services/paired-profile', () => ({
  loadPairedProfile: jest.fn(async () => ({
    saved: {
      profile: { version: 2, host: 'pond.local', port: 4443, localUrls: ['https://192.168.1.2:4443'], remoteAccess: { mode: 'local' } },
      identity: { id: 'profile-1', pin: `sha256/${'A'.repeat(43)}=`, session: 'session-token', refresh: 'refresh-token' },
    },
    upgrade: false,
  })),
  commitPairedProfile: jest.fn(),
}));

// Unregistering the phone on the Pond has to end the session on the phone. Before
// this, revocation only published a state and left the credentials in place: every
// later request failed identically, and remote-access setup went on enrolling
// coordinator nodes against an identity the Pond had already rejected.
it('clears the stored pairing when the Pond stops recognising this phone', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let server!: ReturnType<typeof useServer>;
  const Child = () => { server = useServer(); return null; };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<ServerProvider><Child /></ServerProvider>); });

  // The provider hands the client a callback for "these credentials are dead".
  const onRevoked = jest.mocked(api.setAuthRevoked).mock.calls.at(-1)?.[0];
  expect(onRevoked).toBeInstanceOf(Function);

  jest.mocked(SecureStorage.remove).mockClear();
  jest.mocked(Storage.remove).mockClear();
  await act(async () => { onRevoked!(); await Promise.resolve(); });

  const secrets = jest.mocked(SecureStorage.remove).mock.calls.map(([key]) => key);
  expect(secrets).toEqual(expect.arrayContaining(['pondIdentity', 'sessionToken', 'refreshToken']));
  const stored = jest.mocked(Storage.remove).mock.calls.map(([key]) => key);
  expect(stored).toEqual(expect.arrayContaining(['connectionProfile', 'serverUrl']));
  // The tab layout redirects to pairing on an empty profile, so this is what
  // actually returns the user to a fresh pair.
  expect(server.profileId).toBe('');

  await act(async () => { tree.unmount(); });
});

// The Pond is told first and the pairing survives a failed sign-out, so that path
// must not be routed through the same clearing without its own call.
it('still asks the Pond to release the device on an explicit sign out', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let server!: ReturnType<typeof useServer>;
  const Child = () => { server = useServer(); return null; };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<ServerProvider><Child /></ServerProvider>); });

  jest.mocked(api.handshakeRevoke).mockClear();
  await act(async () => { await server.signOut(); });
  expect(api.handshakeRevoke).toHaveBeenCalledTimes(1);
  expect(server.profileId).toBe('');

  await act(async () => { tree.unmount(); });
});
