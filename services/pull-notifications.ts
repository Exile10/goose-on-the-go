/**
 * Pulls this phone's waiting notifications from the Pond and puts them in the shade.
 *
 * A push wake carries no text (`services/wake-ping.ts`), so the alert itself is
 * read from the Pond over the paired, pinned link and presented here. Each one is
 * acknowledged only after it reaches the shade, so a phone that is put back to
 * sleep part way through pulls what it missed on the next wake rather than losing
 * it. Presenting twice is harmless: the shade entry is keyed by the notification's
 * id and replaces itself.
 */

import { api, type PondApiClient } from './api-client';
import { presentLocally } from './local-notifications';

/** Present and acknowledge every waiting notification. Returns how many were presented. */
export async function pullPendingNotifications(client: PondApiClient = api): Promise<number> {
  const pending = await client.pendingNotifications();
  let presented = 0;
  for (const notification of pending) {
    // Left unacknowledged, it is pulled again on the next wake or flushed to the stream.
    if (!(await presentLocally(notification))) continue;
    presented++;
    // A failed ack only means the next wake presents it again, in place.
    await client.acknowledgeNotification(notification.id).catch((e) => {
      console.warn('[notifications] could not acknowledge', notification.id, e);
    });
  }
  return presented;
}
