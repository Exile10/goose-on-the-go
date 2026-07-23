/**
 * Push-token registration (Path B — direct FCM/APNs, no Expo relay hop).
 *
 * Obtains the NATIVE device push token (`getDevicePushTokenAsync`) and
 * registers it with GIAP (`POST /api/v1/devices/{installId}/push-token`,
 * platform "fcm" on Android / "apns" on iOS). GIAP's own relay then talks to
 * FCM v1 / APNs directly — content-free wake pings only, so notification
 * text never transits Google/Apple servers.
 *
 * Requirements and graceful failure modes:
 * - Needs a development build (`google-services.json` + prebuild); native
 *   push is unavailable in Expo Go and on simulators — both return `null`
 *   here without throwing.
 * - Android 13+ prompts for the POST_NOTIFICATIONS permission; a denial
 *   returns `null` (foreground SSE keeps working regardless).
 * - Token rotation: FCM/APNs may rotate tokens; the registration listener
 *   re-registers using the token the event hands it (see
 *   `watchPushTokenRotation` for why it must not fetch its own).
 */

import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { ApiError, api } from '@/services/api-client';
import { getInstallId } from '@/services/install-id';

export type PushPlatform = 'fcm' | 'apns';

/** Give up after this many attempts; the next rotation or launch retries. */
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;

/**
 * The last token we successfully registered. Rotation events can fire more
 * than once for the same token, and re-POSTing an unchanged one is pure noise
 * against a rate-limited endpoint.
 */
let lastRegistered: string | null = null;

/** The platform GIAP should relay through for this device. */
function pushPlatform(): PushPlatform | null {
  if (Platform.OS === 'android') return 'fcm';
  if (Platform.OS === 'ios') return 'apns';
  return null; // web etc. — foreground SSE only
}

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exponential backoff with equal jitter. The jitter matters because every
 * paired device shares one per-IP budget on the Pond: without it, devices that
 * fail together retry together, and the retries themselves become the load.
 */
function backoffDelay(attempt: number): number {
  const capped = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return capped / 2 + Math.random() * (capped / 2);
}

/**
 * POST the token to GIAP, retrying transient failures with backoff.
 *
 * The server tells us how long to wait when it throttles us (`Retry-After`);
 * honour it when it asks for longer than our own backoff would. Non-retryable
 * failures (4xx other than 429 — unknown device, malformed token) stop
 * immediately: repeating them cannot help and only burns the shared budget.
 */
async function uploadToken(token: string, platform: PushPlatform): Promise<boolean> {
  const installId = await getInstallId();
  const path = `/api/v1/devices/${encodeURIComponent(installId)}/push-token`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await api.request(path, {
        method: 'POST',
        body: JSON.stringify({ token, platform }),
      });
      lastRegistered = token;
      console.log(`[push] registered ${platform} token (…${token.slice(-8)})`);
      return true;
    } catch (e) {
      const apiError = e instanceof ApiError ? e : null;
      if (apiError && !apiError.isRetryable) {
        console.log('[push] registration rejected, not retrying:', apiError.message);
        return false;
      }
      if (attempt === MAX_ATTEMPTS) {
        console.log(`[push] registration failed after ${MAX_ATTEMPTS} attempts:`, e);
        return false;
      }
      const serverAsk = (apiError?.retryAfterSecs ?? 0) * 1000;
      const delay = Math.max(backoffDelay(attempt), serverAsk);
      console.log(`[push] registration attempt ${attempt} failed; retrying in ${Math.round(delay)}ms`);
      await sleep(delay);
    }
  }
  return false;
}

/**
 * Fetch the native push token and register it with the paired GIAP server.
 * Returns the token on success, `null` wherever background push simply is
 * not available (simulator, Expo Go, permission denied, web) — never throws
 * for those cases, since foreground SSE delivery works without it.
 */
export async function registerPushToken(): Promise<string | null> {
  const platform = pushPlatform();
  if (!platform) return null;
  if (!Device.isDevice) {
    console.log('[push] simulator/emulator has no push token; skipping');
    return null;
  }
  if (!(await ensurePermission())) {
    console.log('[push] notification permission not granted; skipping');
    return null;
  }

  let token: string;
  try {
    const native = await Notifications.getDevicePushTokenAsync();
    token = typeof native.data === 'string' ? native.data : JSON.stringify(native.data);
  } catch (e) {
    // Expo Go / missing google-services.json: informative, not fatal.
    console.log('[push] native token unavailable (dev build required):', e);
    return null;
  }

  return (await uploadToken(token, platform)) ? token : null;
}

/**
 * Re-register whenever the platform rotates the token. Returns the remover.
 *
 * The listener registers the token the event carries and deliberately does NOT
 * call `registerPushToken`: that would call `getDevicePushTokenAsync`, which
 * itself emits to this listener, and the two would drive each other in an
 * unbounded loop. expo-notifications warns about exactly this on
 * `addPushTokenListener`. When that loop ran against a paired Pond it spent
 * the whole per-IP rate-limit budget in seconds and locked the device out of
 * pairing — the recovery path — until the server's window rolled over.
 */
export function watchPushTokenRotation(): () => void {
  const sub = Notifications.addPushTokenListener((event) => {
    const platform = pushPlatform();
    if (!platform) return;
    const token = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
    if (token === lastRegistered) return; // already registered; nothing rotated
    // Nothing awaits this listener, so it must swallow its own failures rather
    // than surface them as an unhandled rejection.
    uploadToken(token, platform).catch((e) =>
      console.log('[push] re-registration failed:', e),
    );
  });
  return () => sub.remove();
}
