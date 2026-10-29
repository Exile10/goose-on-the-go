// The key this phone keeps to My Pond: only behind its biometrics, on this device, with a marker that
// says which Pond without asking for them, and nothing left pointing at a key that is gone.

import * as SecureStore from 'expo-secure-store';

import {
  canKeepAdminKey,
  forgetKeptAdminKey,
  isAdminKeyKeptFor,
  keepAdminKey,
  KeptAdminKeyLost,
  keptKeyIsLost,
  keptKeyWasCancelled,
  readKeptAdminKey,
} from '@/services/kept-admin-key';
import { Storage } from '@/services/storage';

jest.mock('expo-secure-store', () => ({
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 6,
  canUseBiometricAuthentication: jest.fn(() => true),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const mockMarker = new Map<string, string>();
jest.mock('@/services/storage', () => ({
  Storage: {
    get: jest.fn(async (key: string) => mockMarker.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => void mockMarker.set(key, value)),
    remove: jest.fn(async (key: string) => void mockMarker.delete(key)),
  },
}));

const store = jest.mocked(SecureStore);
const PIN = `sha256/${'A'.repeat(43)}=`;
const GUARDED = { requireAuthentication: true, keychainAccessible: 6 };

beforeEach(() => {
  jest.clearAllMocks();
  mockMarker.clear();
  store.canUseBiometricAuthentication.mockReturnValue(true);
  store.setItemAsync.mockResolvedValue(undefined);
  store.deleteItemAsync.mockResolvedValue(undefined);
  store.getItemAsync.mockResolvedValue(null);
});

describe('whether a key can be kept', () => {
  it('follows the phone’s biometrics, and is false when the check itself throws', () => {
    expect(canKeepAdminKey()).toBe(true);
    store.canUseBiometricAuthentication.mockReturnValue(false);
    expect(canKeepAdminKey()).toBe(false);
    store.canUseBiometricAuthentication.mockImplementation(() => {
      throw new Error('no module');
    });
    expect(canKeepAdminKey()).toBe(false);
  });
});

describe('keeping', () => {
  it('deletes before it sets, behind biometrics and on this device only, then marks the Pond', async () => {
    await keepAdminKey(PIN, 'key-1', 'Keep a key');
    expect(store.deleteItemAsync).toHaveBeenCalledWith('goose.adminKey', expect.objectContaining(GUARDED));
    expect(store.setItemAsync).toHaveBeenCalledWith('goose.adminKey', 'key-1', expect.objectContaining({ ...GUARDED, authenticationPrompt: 'Keep a key' }));
    expect(store.deleteItemAsync.mock.invocationCallOrder[0]).toBeLessThan(store.setItemAsync.mock.invocationCallOrder[0]);
    expect(mockMarker.get('adminKeyFor')).toBe(PIN);
    // The key itself never reaches AsyncStorage.
    expect(jest.mocked(Storage.set).mock.calls.flat()).not.toContain('key-1');
  });

  it('leaves nothing marked when the save is refused', async () => {
    mockMarker.set('adminKeyFor', PIN);
    store.setItemAsync.mockRejectedValue(new Error('User canceled the authentication'));
    await expect(keepAdminKey(PIN, 'key-2', 'Keep a key')).rejects.toThrow('canceled');
    expect(mockMarker.has('adminKeyFor')).toBe(false);
  });

  it('writes nothing on a phone that cannot keep one', async () => {
    store.canUseBiometricAuthentication.mockReturnValue(false);
    await expect(keepAdminKey(PIN, 'key-1', 'Keep a key')).rejects.toThrow();
    expect(store.setItemAsync).not.toHaveBeenCalled();
    expect(mockMarker.size).toBe(0);
  });
});

describe('knowing one is kept', () => {
  it('reads only the marker, never the key, so no biometric prompt shows', async () => {
    mockMarker.set('adminKeyFor', PIN);
    expect(await isAdminKeyKeptFor(PIN)).toBe(true);
    expect(await isAdminKeyKeptFor('sha256/another')).toBe(false);
    expect(await isAdminKeyKeptFor(null)).toBe(false);
    expect(store.getItemAsync).not.toHaveBeenCalled();
  });
});

describe('reading', () => {
  it('asks nothing when no key is kept for this Pond', async () => {
    mockMarker.set('adminKeyFor', 'sha256/another');
    expect(await readKeptAdminKey(PIN, 'Unlock My Pond')).toBeNull();
    expect(store.getItemAsync).not.toHaveBeenCalled();
  });

  it('reads it behind the prompt', async () => {
    mockMarker.set('adminKeyFor', PIN);
    store.getItemAsync.mockResolvedValue('key-1');
    expect(await readKeptAdminKey(PIN, 'Unlock My Pond')).toBe('key-1');
    expect(store.getItemAsync).toHaveBeenCalledWith('goose.adminKey', expect.objectContaining({ ...GUARDED, authenticationPrompt: 'Unlock My Pond' }));
  });

  it('says the key is lost when the system invalidated it, which SecureStore answers as null', async () => {
    mockMarker.set('adminKeyFor', PIN);
    const e = await readKeptAdminKey(PIN, 'Unlock My Pond').catch((err: unknown) => err);
    expect(e).toBeInstanceOf(KeptAdminKeyLost);
    expect(keptKeyIsLost(e)).toBe(true);
    expect(keptKeyWasCancelled(e)).toBe(false);
  });

  it('passes a cancel through as a cancel, not a loss', async () => {
    mockMarker.set('adminKeyFor', PIN);
    for (const message of [
      "Calling the 'getValueWithKeyAsync' function has failed\n→ Caused by: User canceled the operation.",
      'Could not Authenticate the user: User canceled the authentication. Cancel',
    ]) {
      store.getItemAsync.mockRejectedValueOnce(new Error(message));
      const e = await readKeptAdminKey(PIN, 'Unlock My Pond').catch((err: unknown) => err);
      expect(keptKeyWasCancelled(e)).toBe(true);
      expect(keptKeyIsLost(e)).toBe(false);
    }
  });

  it('counts a permanently invalidated key or no enrolled biometrics as lost', () => {
    expect(keptKeyIsLost(new Error('The key goose.adminKey has been permanently invalidated'))).toBe(true);
    expect(keptKeyIsLost(new Error('Could not Authenticate the user: No biometrics enrolled.'))).toBe(true);
    expect(keptKeyIsLost(new Error('Could not Authenticate the user: Lockout.'))).toBe(false);
  });
});

describe('forgetting', () => {
  it('removes the marker and the key, and never throws', async () => {
    mockMarker.set('adminKeyFor', PIN);
    store.deleteItemAsync.mockRejectedValue(new Error('keychain busy'));
    await expect(forgetKeptAdminKey()).resolves.toBeUndefined();
    expect(mockMarker.has('adminKeyFor')).toBe(false);
    expect(store.deleteItemAsync).toHaveBeenCalledWith('goose.adminKey', expect.objectContaining(GUARDED));
  });
});
