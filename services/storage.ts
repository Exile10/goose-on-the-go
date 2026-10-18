/**
 * Typed AsyncStorage wrapper for persistent key-value storage.
 *
 * AsyncStorage is unencrypted. Nothing sensitive belongs here — tokens and any
 * other credential go through `services/secure-storage.ts`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  serverUrl: '@goose/server-url',
  connectionProfile: '@goose/connection-profile',
  lastScreen: '@goose/last-screen',
  settings: '@goose/settings',
  devScreenModes: '@goose/dev-screen-modes',
  themePreference: '@goose/theme-preference',
  /** Whether this phone plays haptic feedback. A preference of the phone, not of the Pond. */
  hapticsEnabled: '@goose/haptics-enabled',
  onboardingDone: '@goose/onboarding-done',
  chatHistoryView: '@goose/chat-history-view',
  remoteOfferDismissed: '@goose/remote-offer-dismissed',
  /** When the Pond will drop remote access unless the phone is seen at home. Not a secret. */
  remoteLapsesAt: '@goose/remote-lapses-at',
} as const;

/**
 * Keys written by builds that predate secure token storage.
 *
 * Nothing reads or writes these any more, but removing the key from `KEYS` does
 * not remove the value from a device that already has one: an install that ran
 * an older build still holds a plaintext bearer token that nothing would ever
 * clear. This list exists so `purgeLegacyStorage()` can delete them.
 */
const LEGACY_KEYS = [
  // Session token, held in the clear before it moved to the Keychain /
  // EncryptedSharedPreferences in services/secure-storage.ts.
  '@goose/token',
] as const;

type StorageKey = keyof typeof KEYS;

/**
 * Families of keys: one record per id under a shared prefix, for data that
 * grows with use rather than with the app. Each record is a key of its own, so
 * writing one never rewrites the rest.
 */
const FAMILIES = {
  toolCards: '@goose/tool-cards/',
} as const;

type StorageFamily = keyof typeof FAMILIES;

/**
 * Delete anything an earlier build left behind in plaintext.
 *
 * Safe to call on every launch: `multiRemove` on absent keys is a no-op, so this
 * costs one AsyncStorage round trip and needs no "have I migrated yet" flag —
 * which would itself be a thing that can go wrong.
 */
export async function purgeLegacyStorage(): Promise<void> {
  await AsyncStorage.multiRemove([...LEGACY_KEYS]);
}

export const Storage = {
  async get(key: StorageKey): Promise<string | null> {
    return AsyncStorage.getItem(KEYS[key]);
  },

  async set(key: StorageKey, value: string): Promise<void> {
    return AsyncStorage.setItem(KEYS[key], value);
  },

  async remove(key: StorageKey): Promise<void> {
    return AsyncStorage.removeItem(KEYS[key]);
  },

  async getJSON<T>(key: StorageKey): Promise<T | null> {
    const raw = await AsyncStorage.getItem(KEYS[key]);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  async setJSON<T>(key: StorageKey, value: T): Promise<void> {
    return AsyncStorage.setItem(KEYS[key], JSON.stringify(value));
  },
};

function parse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** One family's records, by id. */
export function storageFamily(family: StorageFamily) {
  const prefix = FAMILIES[family];
  return {
    async ids(): Promise<string[]> {
      const keys = await AsyncStorage.getAllKeys();
      return keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    },

    async getJSON<T>(id: string): Promise<T | null> {
      return parse<T>(await AsyncStorage.getItem(prefix + id));
    },

    /** Several at once; an id with nothing readable is absent from the map. */
    async getManyJSON<T>(ids: string[]): Promise<Map<string, T>> {
      const found = new Map<string, T>();
      if (ids.length === 0) return found;
      for (const [key, raw] of await AsyncStorage.multiGet(ids.map((id) => prefix + id))) {
        const value = parse<T>(raw);
        if (value !== null) found.set(key.slice(prefix.length), value);
      }
      return found;
    },

    async setJSON<T>(id: string, value: T): Promise<void> {
      return AsyncStorage.setItem(prefix + id, JSON.stringify(value));
    },

    async remove(ids: string[]): Promise<void> {
      if (ids.length > 0) await AsyncStorage.multiRemove(ids.map((id) => prefix + id));
    },
  };
}
