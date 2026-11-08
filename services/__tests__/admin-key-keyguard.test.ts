/**
 * On Android the admin key lives in PondKeyguard, which opens with a fingerprint or the phone's
 * screen lock; a key kept before it existed opens the old way once and moves.
 */

const mockLegacy = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'whenPasscodeSet',
  canUseBiometricAuthentication: () => true,
  getItemAsync: async (key: string) => mockLegacy.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockLegacy.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockLegacy.delete(key);
  },
}));

const mockSealed = new Map<string, string>();
const mockKeyguard = {
  available: jest.fn(() => true),
  has: jest.fn((slot: string) => mockSealed.has(slot)),
  save: jest.fn(async (slot: string, secret: string) => {
    mockSealed.set(slot, secret);
  }),
  read: jest.fn(async (slot: string) => mockSealed.get(slot) ?? null),
  forget: jest.fn(async (slot: string) => {
    mockSealed.delete(slot);
  }),
};
let mockOS = 'android';
jest.mock('react-native', () => ({
  Platform: { get OS() { return mockOS; } },
  NativeModules: { get PondKeyguard() { return mockOS === 'android' ? mockKeyguard : undefined; } },
}));

import { AdminKeyKeychain } from '@/services/secure-storage';

beforeEach(() => {
  mockLegacy.clear();
  mockSealed.clear();
  Object.values(mockKeyguard).forEach((fn) => fn.mockClear());
  mockOS = 'android';
});

describe('the admin key on Android', () => {
  it('is kept in the store that opens with a fingerprint or the screen lock', async () => {
    await AdminKeyKeychain.save('card-key', 'Keep a key', 'pond');
    expect(mockKeyguard.save).toHaveBeenCalledWith('pond', 'card-key', 'Keep a key');
    expect(mockLegacy.size).toBe(0);
    await expect(AdminKeyKeychain.read('Unlock', 'pond')).resolves.toBe('card-key');
    expect(mockKeyguard.read).toHaveBeenCalledWith('pond', 'Unlock');
  });

  it('opens a key kept the old way, then moves it so the screen lock opens it too', async () => {
    mockLegacy.set('goose.adminKey', 'old-key');
    await expect(AdminKeyKeychain.read('Unlock', 'pond')).resolves.toBe('old-key');
    expect(mockSealed.get('pond')).toBe('old-key');
    expect(mockLegacy.has('goose.adminKey')).toBe(false);
  });

  it('leaves the old key where it was when the second check is declined', async () => {
    mockLegacy.set('goose.adminKey', 'old-key');
    mockKeyguard.save.mockRejectedValueOnce(new Error('cancelled'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(AdminKeyKeychain.read('Unlock', 'pond')).resolves.toBe('old-key');
    expect(mockLegacy.get('goose.adminKey')).toBe('old-key');
    warn.mockRestore();
  });

  it('is offered whenever the phone has a screen lock to check, and forgotten from both stores', async () => {
    expect(AdminKeyKeychain.available()).toBe(true);
    mockKeyguard.available.mockReturnValueOnce(false);
    expect(AdminKeyKeychain.available()).toBe(false);
    mockSealed.set('mock', 'k');
    mockLegacy.set('goose.adminKey.mock', 'k');
    await AdminKeyKeychain.forget('mock');
    expect(mockSealed.has('mock')).toBe(false);
    expect(mockLegacy.has('goose.adminKey.mock')).toBe(false);
  });
});

describe('the admin key on iOS', () => {
  it('stays in the Keychain behind Face ID or a fingerprint', async () => {
    mockOS = 'ios';
    await AdminKeyKeychain.save('card-key', 'Keep a key', 'pond');
    expect(mockKeyguard.save).not.toHaveBeenCalled();
    expect(mockLegacy.get('goose.adminKey')).toBe('card-key');
  });
});
