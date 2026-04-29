/**
 * SecureStorage — wrapper for sensitive values (auth tokens).
 *
 * Prefers `expo-secure-store` (Keychain on iOS, EncryptedSharedPreferences
 * on Android). Falls back to AsyncStorage when SecureStore is not installed
 * — in that case a console warning is emitted on first use so the operator
 * can choose to upgrade the dependency.
 *
 * To enable hardware-backed storage:
 *   npx expo install expo-secure-store
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

type SecureStoreModule = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

let secureStore: SecureStoreModule | null = null;
try {
  // Optional dep — resolved at runtime, not at bundle time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  secureStore = require('expo-secure-store') as SecureStoreModule;
} catch {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn(
      'expo-secure-store not installed — falling back to AsyncStorage for tokens. ' +
        'Run `npx expo install expo-secure-store` to enable hardware-backed storage.',
    );
  }
}

const KEYS = {
  sessionToken: 'goose.sessionToken',
  refreshToken: 'goose.refreshToken',
  /** Stable per-install identifier used as `client_id` in every handshake. */
  installId: 'goose.installId',
} as const;

export type SecureKey = keyof typeof KEYS;

export const SecureStorage = {
  async get(key: SecureKey): Promise<string | null> {
    if (secureStore) return secureStore.getItemAsync(KEYS[key]);
    return AsyncStorage.getItem(KEYS[key]);
  },
  async set(key: SecureKey, value: string): Promise<void> {
    if (secureStore) return secureStore.setItemAsync(KEYS[key], value);
    return AsyncStorage.setItem(KEYS[key], value);
  },
  async remove(key: SecureKey): Promise<void> {
    if (secureStore) return secureStore.deleteItemAsync(KEYS[key]);
    return AsyncStorage.removeItem(KEYS[key]);
  },
};
