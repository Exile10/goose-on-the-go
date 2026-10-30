/**
 * The pairing must be readable by a push wake while an iPhone is locked, and the
 * Keychain applies that only to a newly created item, so it moves to its own service.
 */

const mockStore = new Map<string, string>();
const keyOf = (key: string, options?: { keychainService?: string }) => `${options?.keychainService ?? 'default'}/${key}`;
const mockSet = jest.fn(async (key: string, value: string, options?: { keychainService?: string }) => {
  mockStore.set(keyOf(key, options), value);
});
const mockDelete = jest.fn(async (key: string, options?: { keychainService?: string }) => {
  mockStore.delete(keyOf(key, options));
});

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 'afterFirstUnlock',
  getItemAsync: async (key: string, options?: { keychainService?: string }) => mockStore.get(keyOf(key, options)) ?? null,
  setItemAsync: (key: string, value: string, options?: { keychainService?: string }) => mockSet(key, value, options),
  deleteItemAsync: (key: string, options?: { keychainService?: string }) => mockDelete(key, options),
}));

let mockOS = 'ios';
jest.mock('react-native', () => ({ Platform: { get OS() { return mockOS; } } }));

import { SecureStorage } from '@/services/secure-storage';

const LOCKED = 'goose.afterFirstUnlock/goose.pondIdentity';
const OLD = 'default/goose.pondIdentity';

beforeEach(() => {
  mockStore.clear();
  mockSet.mockClear();
  mockOS = 'ios';
});

describe('the pairing on iOS', () => {
  it('is written readable after first unlock, in its own service', async () => {
    await SecureStorage.set('pondIdentity', 'id-1');
    expect(mockSet).toHaveBeenCalledWith('goose.pondIdentity', 'id-1',
      { keychainService: 'goose.afterFirstUnlock', keychainAccessible: 'afterFirstUnlock' });
    expect([...mockStore.keys()]).toEqual([LOCKED]);
  });

  it('is still read from where an older version left it', async () => {
    mockStore.set(OLD, 'id-old');
    await expect(SecureStorage.get('pondIdentity')).resolves.toBe('id-old');
  });

  it('moves on its next write, removing the old copy only after the new one is saved', async () => {
    mockStore.set(OLD, 'id-old');
    await SecureStorage.set('pondIdentity', 'id-new');
    expect(mockStore.get(LOCKED)).toBe('id-new');
    expect(mockStore.has(OLD)).toBe(false);
  });

  it('keeps the old copy when the new one could not be saved', async () => {
    mockStore.set(OLD, 'id-old');
    mockSet.mockRejectedValueOnce(new Error('keychain'));
    await expect(SecureStorage.set('pondIdentity', 'id-new')).rejects.toThrow('keychain');
    await expect(SecureStorage.get('pondIdentity')).resolves.toBe('id-old');
  });

  it('is gone from both places once removed', async () => {
    mockStore.set(OLD, 'id-old');
    mockStore.set(LOCKED, 'id-new');
    await SecureStorage.remove('pondIdentity');
    await expect(SecureStorage.get('pondIdentity')).resolves.toBeNull();
  });
});

describe('everything else', () => {
  it('keeps the default setting, as does the pairing on Android', async () => {
    await SecureStorage.set('installId', 'install-1');
    mockOS = 'android';
    await SecureStorage.set('pondIdentity', 'id-1');
    expect(mockSet.mock.calls.map((call) => call[2])).toEqual([undefined, undefined]);
  });
});
