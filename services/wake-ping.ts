/**
 * Reads the Pond's wake ping out of a background notification task's payload.
 *
 * The Pond's push carries no text, only `{ wake: "1", notification_id, category }`
 * (`wake_message` in the Pond's `fcm_push_relay.rs`, and the APNs path that
 * mirrors it). expo-notifications hands both platforms' payloads to the task with
 * those keys under `data`: Android copies the FCM data map there, iOS copies every
 * key outside `aps`. Anything else, including a tapped notification's response,
 * is not a wake ping.
 */

export interface WakePing {
  notificationId: string;
  category: string;
}

export function readWakePing(payload: unknown): WakePing | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const { wake, notification_id: id, category } = data as Record<string, unknown>;
  if (wake !== '1' || typeof id !== 'string' || !id) return null;
  return { notificationId: id, category: typeof category === 'string' ? category : 'info' };
}
