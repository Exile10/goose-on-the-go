/**
 * SecureStorage — the only place a credential is allowed to be persisted.
 *
 * Session and refresh tokens go to the iOS Keychain / Android
 * EncryptedSharedPreferences via `expo-secure-store`, never to AsyncStorage.
 * AsyncStorage is unencrypted, so a token there is readable by anything with
 * filesystem access to the app's sandbox — a rooted or jailbroken device, or a
 * backup extraction.
 *
 * `expo-secure-store` is a hard dependency (package.json, and a plugin in
 * app.json). It is imported statically and deliberately has no fallback: a
 * missing native module raises, rather than silently downgrading token storage
 * to plaintext. Silence is the failure mode worth preventing here — the app
 * would look fine and the tokens would be in the clear.
 *
 * Web is the exception, and holds tokens in memory only. There is no keychain in
 * a browser, and the alternatives (localStorage, AsyncStorage) are exactly what
 * this module exists to avoid. Tokens therefore do not survive a reload there.
 * That is acceptable because web is a development preview, not a shipping
 * target; see `docs/TESTING.md`.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEYS = {
  pondIdentity: 'goose.pondIdentity',
  sessionToken: 'goose.sessionToken',
  refreshToken: 'goose.refreshToken',
  /** Stable per-install identifier used as `client_id` in every handshake. */
  installId: 'goose.installId',
} as const;

export type SecureKey = keyof typeof KEYS;

const isWeb = Platform.OS === 'web';

/** Web-only, deliberately not persisted. See the module comment. */
const ephemeral = new Map<string, string>();

let warnedAboutWeb = false;
function warnOnceOnWeb(): void {
  if (warnedAboutWeb || !__DEV__) return;
  warnedAboutWeb = true;
  // eslint-disable-next-line no-console
  console.warn(
    '[secure-storage] Running on web: tokens are held in memory only and will ' +
      'not survive a reload. A browser has no keychain, and writing them to ' +
      'localStorage would defeat the point. Pair again after reloading.',
  );
}

/** Kept apart from `KEYS`: read only behind the phone's own biometrics, never alongside the tokens. */
const ADMIN_KEYS = { pond: 'goose.adminKey', mock: 'goose.adminKey.mock' } as const;

/** Whose key a slot holds: the paired Pond's, or the Developer toggle's mock Pond's. */
export type AdminKeySlot = keyof typeof ADMIN_KEYS;

function adminKeyOptions(prompt?: string): SecureStore.SecureStoreOptions {
  return {
    requireAuthentication: true,
    authenticationPrompt: prompt,
    // Never in a backup or on another phone, and only while this one has a passcode.
    keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  };
}

/**
 * This phone's own key to My Pond, kept only when the member chooses to, and readable only after the
 * phone's Face ID or fingerprint. A new face or finger invalidates it. Web cannot hold it at all.
 */
export const AdminKeyKeychain = {
  available(): boolean {
    if (isWeb) return false;
    try {
      return SecureStore.canUseBiometricAuthentication() === true;
    } catch {
      return false;
    }
  },

  async save(key: string, prompt: string, slot: AdminKeySlot): Promise<void> {
    if (isWeb) throw new Error('A browser cannot keep the admin key');
    // Updating a kept item asks for biometrics on iOS; a fresh one is written without asking.
    await SecureStore.deleteItemAsync(ADMIN_KEYS[slot], adminKeyOptions()).catch(() => undefined);
    await SecureStore.setItemAsync(ADMIN_KEYS[slot], key, adminKeyOptions(prompt));
  },

  /** Asks for the phone's biometrics. Null when nothing is kept or the system invalidated it; throws on a refusal. */
  async read(prompt: string, slot: AdminKeySlot): Promise<string | null> {
    if (isWeb) return null;
    return SecureStore.getItemAsync(ADMIN_KEYS[slot], adminKeyOptions(prompt));
  },

  async forget(slot: AdminKeySlot): Promise<void> {
    if (isWeb) return;
    await SecureStore.deleteItemAsync(ADMIN_KEYS[slot], adminKeyOptions());
  },
};

export const SecureStorage = {
  async get(key: SecureKey): Promise<string | null> {
    if (isWeb) {
      warnOnceOnWeb();
      return ephemeral.get(KEYS[key]) ?? null;
    }
    return SecureStore.getItemAsync(KEYS[key]);
  },

  async set(key: SecureKey, value: string): Promise<void> {
    if (isWeb) {
      warnOnceOnWeb();
      ephemeral.set(KEYS[key], value);
      return;
    }
    return SecureStore.setItemAsync(KEYS[key], value);
  },

  async remove(key: SecureKey): Promise<void> {
    if (isWeb) {
      ephemeral.delete(KEYS[key]);
      return;
    }
    return SecureStore.deleteItemAsync(KEYS[key]);
  },
};
