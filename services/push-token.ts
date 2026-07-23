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
 *   re-registers on every rotation event.
 */

import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from '@/services/api-client';
import { getInstallId } from '@/services/install-id';

export type PushPlatform = 'fcm' | 'apns';

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

  const installId = await getInstallId();
  await api.request(`/api/v1/devices/${encodeURIComponent(installId)}/push-token`, {
    method: 'POST',
    body: JSON.stringify({ token, platform }),
  });
  console.log(`[push] registered ${platform} token (…${token.slice(-8)})`);
  return token;
}

/**
 * Re-register whenever the platform rotates the token. Returns the remover.
 */
export function watchPushTokenRotation(): () => void {
  const sub = Notifications.addPushTokenListener(() => {
    registerPushToken().catch((e) => console.log('[push] re-registration failed:', e));
  });
  return () => sub.remove();
}
