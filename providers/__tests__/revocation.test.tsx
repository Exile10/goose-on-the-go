import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ServerProvider, useServer } from '../server-provider';
import { SecureStorage } from '@/services/secure-storage';
import { Storage } from '@/services/storage';
import { api, ApiError } from '@/services/api-client';
import { forgetKeptAdminKey } from '@/services/kept-admin-key';
import { forgetAllCards } from '@/services/card-cache';
import { forgetPondImages } from '@/services/pond-images';
import { forgetPushRegistration } from '@/services/push-token';

jest.mock('@react-native-community/netinfo', () => ({
  configure: jest.fn(), addEventListener: jest.fn(() => () => undefined),
  fetch: jest.fn(async () => ({ type: 'wifi' })),
}));
const mockFamilyClear = jest.fn(async (_family: string) => undefined);
jest.mock('@/services/storage', () => ({
  Storage: { set: jest.fn(), remove: jest.fn(), getJSON: jest.fn(async () => null), setJSON: jest.fn() },
  purgeLegacyStorage: jest.fn(),
  storageFamily: (family: string) => ({ clear: () => mockFamilyClear(family) }),
}));
jest.mock('@/services/pond-images', () => ({ forgetPondImages: jest.fn() }));
jest.mock('@/services/push-token', () => ({ forgetPushRegistration: jest.fn() }));
// Signing out also forgets the tool cards; that store is not what these tests are about.
jest.mock('@/services/card-cache', () => ({ forgetAllCards: jest.fn(async () => undefined) }));
jest.mock('@/services/kept-admin-key', () => ({ forgetKeptAdminKey: jest.fn(async () => undefined) }));
jest.mock('@/services/secure-storage', () => ({ SecureStorage: { set: jest.fn(), remove: jest.fn(), getJSON: jest.fn(async () => null), setJSON: jest.fn() } }));
jest.mock('@/services/pond-trust', () => ({ configurePondTrust: jest.fn(async () => undefined), PondTrustError: class extends Error {} }));
jest.mock('@/services/discovery', () => ({ findPondByHost: jest.fn(async () => null), findPondAt: jest.fn(async () => null) }));
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
  // A key to My Pond opens only the Pond this phone has left.
  expect(forgetKeptAdminKey).toHaveBeenCalled();
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
  await act(async () => { await server.unpair(); });
  expect(api.handshakeRevoke).toHaveBeenCalledTimes(1);
  expect(server.profileId).toBe('');

  await act(async () => { tree.unmount(); });
});

// A Pond that already refuses the session answers the revoke with a 401. That is the
// release having happened, not a failure to retry: a phone the Pond dropped could
// otherwise never sign out.
it('signs out when the Pond has already dropped the session', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let server!: ReturnType<typeof useServer>;
  const Child = () => { server = useServer(); return null; };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<ServerProvider><Child /></ServerProvider>); });

  jest.mocked(api.handshakeRevoke).mockRejectedValueOnce(new (ApiError as unknown as new () => Error)());
  await act(async () => { await server.unpair(); });
  expect(server.profileId).toBe('');

  await act(async () => { tree.unmount(); });
});

// Anything else is ambiguous: the Pond may still hold the session, so the pairing stays
// for an explicit retry.
it('keeps the pairing when the revoke did not reach the Pond', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let server!: ReturnType<typeof useServer>;
  const Child = () => { server = useServer(); return null; };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<ServerProvider><Child /></ServerProvider>); });

  jest.mocked(api.handshakeRevoke).mockRejectedValueOnce(new Error('network'));
  await act(async () => { await expect(server.unpair()).rejects.toThrow('network'); });
  expect(server.profileId).toBe('profile-1');

  await act(async () => { tree.unmount(); });
});

// The tab layout redirects to pairing when nothing is paired. Staging another pairing clears the
// in-memory identity while the stored one stays, so the gate must key on the stored pairing, or
// starting "Pair another Pond" throws the user out of the tabs mid-wizard.
it('still reports a stored pairing while another is being staged', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let server!: ReturnType<typeof useServer>;
  const Child = () => { server = useServer(); return null; };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<ServerProvider><Child /></ServerProvider>); });
  expect(server.paired).toBe(true);

  let staging!: Promise<unknown>;
  await act(async () => {
    staging = server.stagePairing({ version: 2, host: 'other.local', port: 4443,
      localUrls: ['https://192.168.1.3:4443'] }, `sha256/${'B'.repeat(43)}=`).catch((error: Error) => error);
  });
  expect(server.profileId).toBe('');
  expect(server.paired).toBe(true);

  await act(async () => { await server.cancelPairing(); await staging; });
  await act(async () => { tree.unmount(); });
});

// "Remove from this phone", for a Pond that cannot be asked: everything a sign-out clears is
// cleared, and the Pond is not contacted at all, since that is the call that just failed.
it('forgets the Pond on this phone alone, keeping nothing of the household', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let server!: ReturnType<typeof useServer>;
  const Child = () => { server = useServer(); return null; };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<ServerProvider><Child /></ServerProvider>); });
  expect(server.paired).toBe(true);

  jest.mocked(api.handshakeRevoke).mockClear();
  jest.mocked(SecureStorage.remove).mockClear();
  jest.mocked(Storage.remove).mockClear();
  jest.mocked(forgetAllCards).mockClear();
  jest.mocked(forgetPondImages).mockClear();
  jest.mocked(forgetPushRegistration).mockClear();
  mockFamilyClear.mockClear();
  const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  await act(async () => { await server.forgetLocally(); });

  expect(api.handshakeRevoke).not.toHaveBeenCalled();
  const secrets = jest.mocked(SecureStorage.remove).mock.calls.map(([key]) => key);
  expect(secrets).toEqual(expect.arrayContaining(['pondIdentity', 'sessionToken', 'refreshToken']));
  const stored = jest.mocked(Storage.remove).mock.calls.map(([key]) => key);
  expect(stored).toEqual(expect.arrayContaining(['connectionProfile', 'serverUrl', 'remoteLapsesAt']));
  expect(mockFamilyClear.mock.calls.map(([family]) => family)).toEqual(expect.arrayContaining(['setupDrafts', 'setupChecklist']));
  expect(forgetAllCards).toHaveBeenCalledTimes(1);
  expect(forgetPondImages).toHaveBeenCalledTimes(1);
  // Otherwise the next Pond paired in this process is never sent the unchanged push token.
  expect(forgetPushRegistration).toHaveBeenCalledTimes(1);
  expect(server.paired).toBe(false);
  expect(server.profileId).toBe('');
  expect(info).toHaveBeenCalledWith('[unpair] kind=forgotten_locally');
  info.mockRestore();

  await act(async () => { tree.unmount(); });
});
