/**
 * Pulls this phone's waiting notifications from the Pond and puts them in the shade.
 *
 * A push wake carries no text (`services/wake-ping.ts`), so the alert itself is
 * read from the Pond over the paired, pinned link and presented here. Each one is
 * acknowledged only after it reaches the shade, so a phone that is put back to
 * sleep part way through pulls what it missed on the next wake rather than losing
 * it. Presenting twice is harmless: the shade entry is keyed by the notification's
 * id and replaces itself.
 *
 * A pulled alert can reach the shade well after it happened (the phone was
 * asleep, the link was down), and the shade shows when it arrived, not when the
 * door opened. So the Pond's own time is added to its text.
 */

import { api, type PondApiClient } from './api-client';
import { presentLocally } from './local-notifications';
import type { ServerNotification } from './notification-stream';

/** The notification with the time it happened appended to its text: the time alone today, with the date before that. */
export function withEventTime(notification: ServerNotification, now = new Date()): ServerNotification {
  const at = new Date(notification.timestamp);
  if (Number.isNaN(at.getTime())) return notification;
  const time = { hour: 'numeric', minute: '2-digit' } as const;
  const when = at.toDateString() === now.toDateString()
    ? at.toLocaleTimeString([], time)
    : at.toLocaleString([], { month: 'short', day: 'numeric', ...time });
  return { ...notification, body: notification.body ? `${notification.body} · ${when}` : when };
}

/** Present and acknowledge every waiting notification. Returns how many were presented. */
export async function pullPendingNotifications(client: PondApiClient = api): Promise<number> {
  const pending = await client.pendingNotifications();
  let presented = 0;
  for (const notification of pending) {
    // Left unacknowledged, it is pulled again on the next wake or flushed to the stream.
    if (!(await presentLocally(withEventTime(notification)))) continue;
    presented++;
    // A failed ack only means the next wake presents it again, in place.
    await client.acknowledgeNotification(notification.id).catch((e) => {
      console.warn('[notifications] could not acknowledge', notification.id, e);
    });
  }
  return presented;
}
