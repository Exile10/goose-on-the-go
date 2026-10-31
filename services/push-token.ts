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
import { notifications, type NotificationsModule } from '@/services/notifications-module';
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

/**
 * The registration currently in flight, so concurrent callers share it.
 *
 * `lastRegistered` alone is check-then-act: it is only set after the POST
 * returns, so two callers that start before either finishes both read null and
 * both upload. NotificationsProvider does exactly that — it hydrates serverUrl
 * and token as separate state updates, so its effect runs twice at mount, and a
 * real device duplicates the POST 51ms apart.
 */
let inFlight: Promise<string | null> | null = null;

/** The platform GIAP should relay through for this device. */
function pushPlatform(): PushPlatform | null {
  if (Platform.OS === 'android') return 'fcm';
  if (Platform.OS === 'ios') return 'apns';
  return null; // web etc. — foreground SSE only
}

async function ensurePermission(Notifications: NotificationsModule): Promise<boolean> {
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
  const Notifications = notifications;
  if (!Notifications) return null; // Expo Go: see notifications-module.ts
  if (!Device.isDevice) {
    console.log('[push] simulator/emulator has no push token; skipping');
    return null;
  }
  if (!(await ensurePermission(Notifications))) {
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

  // Callers re-run this whenever the session token changes, so an unchanged
  // native token would otherwise be re-POSTed on every silent refresh. The
  // rotation listener below already guards this way; both share one per-IP
  // budget on the Pond, so both have to.
  if (token === lastRegistered) return token;

  // Coalesce racing callers onto one upload, then clear so a later genuine
  // rotation is not swallowed by a stale promise.
  if (!inFlight) {
    inFlight = uploadToken(token, platform)
      .then((ok) => (ok ? token : null))
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/**
 * Forget which token was registered, because the Pond it went to is no longer this phone's.
 *
 * The memo exists to spare one Pond's rate limit, and it is not keyed by Pond. Kept across a
 * sign-out, it made the next pairing in the same process skip its upload: the native token had
 * not changed, so the new Pond was never given one and could not wake this phone. An upload
 * already in flight is left to finish; it is addressed to whatever the client points at.
 */
export function forgetPushRegistration(): void {
  lastRegistered = null;
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
  const Notifications = notifications;
  if (!Notifications) return () => {}; // Expo Go: see notifications-module.ts
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
