import type { SavedPond } from '@/services/paired-profile';

const mockLoad = jest.fn();
const mockTrust = jest.fn().mockResolvedValue(undefined);
const mockHealth = jest.fn();
const created: { url: string; token: string | null; refreshToken: string | null }[] = [];
const mockShared = { signedIn: false };

jest.mock('@/services/paired-profile', () => ({ loadPairedProfile: () => mockLoad() }));
jest.mock('@/services/pond-trust', () => ({ configurePondTrust: (entries: unknown) => mockTrust(entries) }));
jest.mock('@/services/api-client', () => ({
  get api() { return mockShared; },
  PondApiClient: class {
    record: { url: string; token: string | null; refreshToken: string | null };
    constructor(url: string) {
      this.record = { url, token: null, refreshToken: null };
      created.push(this.record);
    }
    health() { return mockHealth(this.record.url); }
    setToken(token: string) { this.record.token = token; }
    setRefreshToken(token: string) { this.record.refreshToken = token; }
  },
}));

import { pondForBackground } from '@/services/background-pond';

const SAVED: SavedPond = {
  identity: { id: 'pond-1', pin: 'a'.repeat(64), session: 'session-1', refresh: 'refresh-1' },
  profile: {
    version: 2, host: 'pond.local', port: 4443,
    localUrls: ['https://192.168.1.20:4443', 'https://pond.local:4443'],
    remoteUrl: 'https://pond.tail:4443',
    remoteAccess: { mode: 'embedded', controlUrl: 'https://control.test' },
  },
};

beforeEach(() => {
  created.length = 0;
  mockShared.signedIn = false;
  mockLoad.mockResolvedValue({ saved: SAVED, upgrade: false });
  mockHealth.mockResolvedValue({ ok: true, latencyMs: 1 });
  mockTrust.mockClear();
});

describe('pondForBackground', () => {
  it('uses the running app’s client when it is signed in', async () => {
    mockShared.signedIn = true;
    await expect(pondForBackground()).resolves.toBe(mockShared);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('on a cold start, pins every saved address and signs in at the first home address that answers', async () => {
    mockHealth.mockImplementation(async (url: string) => ({ ok: url === 'https://pond.local:4443', latencyMs: 1 }));

    const client = await pondForBackground();

    expect(mockTrust).toHaveBeenCalledWith([
      { url: 'https://192.168.1.20:4443', pin: SAVED.identity.pin },
      { url: 'https://pond.local:4443', pin: SAVED.identity.pin },
      { url: 'https://pond.tail:4443', pin: SAVED.identity.pin },
    ]);
    expect(client).not.toBeNull();
    expect(created.map((c) => c.url)).toEqual(['https://192.168.1.20:4443', 'https://pond.local:4443']);
    expect(created[1]).toEqual({ url: 'https://pond.local:4443', token: 'session-1', refreshToken: null });
  });

  it('never hands the background client the refresh token', async () => {
    await pondForBackground();
    expect(created.every((c) => c.refreshToken === null)).toBe(true);
  });

  it('reaches nothing when no home address answers', async () => {
    mockHealth.mockResolvedValue({ ok: false, latencyMs: 1 });
    await expect(pondForBackground()).resolves.toBeNull();
  });

  it('reaches nothing when this phone is not paired', async () => {
    mockLoad.mockResolvedValue({ saved: null, upgrade: false });
    await expect(pondForBackground()).resolves.toBeNull();
    expect(mockTrust).not.toHaveBeenCalled();
  });
});
