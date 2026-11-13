/**
 * The line an iPhone shows for a wake: "Something new from your Pond."
 *
 * It stands for a notice until the phone has fetched the notice itself. Once a fetch of the
 * pending list has shown what the Pond held, the line is taken out of the shade, so the person
 * sees the notice and not both. A tap on the line opens the app before anything is fetched, so
 * the tap waits here for the next fetch to say where it leads.
 */

import { Platform } from 'react-native';

import { notifications, type NotificationsModule } from './notifications-module';
import type { ServerNotification } from './notification-stream';
import { wakePingOfNotification } from './wake-ping';

type WakeAlertModule = Pick<NotificationsModule, 'getPresentedNotificationsAsync' | 'dismissNotificationAsync'>;

/**
 * Take every fixed line out of the shade. `shown` is what was just put there: iOS files a wake
 * under its notice's id, and a dismissal by that id that took the notice with it puts it back.
 * Resolves how many were dismissed; never throws.
 */
export async function dismissWakeAlerts(
  shown: readonly ServerNotification[],
  present: (notification: ServerNotification) => Promise<boolean>,
  Notifications: WakeAlertModule | null = notifications,
): Promise<number> {
  if (!Notifications || Platform.OS !== 'ios') return 0;
  let dismissed = 0;
  try {
    for (const presented of await Notifications.getPresentedNotificationsAsync()) {
      if (!wakePingOfNotification(presented)) continue;
      const id = presented.request.identifier;
      await Notifications.dismissNotificationAsync(id);
      dismissed++;
      const twin = shown.find((n) => n.id === id);
      if (twin) await present(twin);
    }
  } catch (e) {
    console.warn('[wake] could not clear the wake alert', { kind: 'wake_alert', error: String(e) });
  }
  return dismissed;
}

/** How long a fetched notice can still answer a tap that arrives after its fetch. */
const RECENT_MS = 15_000;
/** How long a tap waits for a fetch before it is dropped: a Pond out of reach leads nowhere. */
const TAP_WAIT_MS = 60_000;

let recent: { at: number; notice: ServerNotification }[] = [];
let tappedAt: number | null = null;
let onLead: ((notice: ServerNotification) => void) | null = null;

/** Hear where a tapped wake alert leads: the one notice a fetch found for it. Returns the unsubscribe. */
export function watchWakeTaps(listener: (notice: ServerNotification) => void): () => void {
  onLead = listener;
  return () => {
    if (onLead === listener) onLead = null;
  };
}

/** What a fetch of the pending list returned, kept briefly: recorded at the fetch, not at its end. */
export function noteFetched(notices: readonly ServerNotification[], now = Date.now()): void {
  recent = [...recent.filter((r) => now - r.at <= RECENT_MS), ...notices.map((notice) => ({ at: now, notice }))];
}

/** A fetch of the pending list finished, which answers a tap that was waiting on one. */
export function noteDrained(now = Date.now()): void {
  settle(now, true);
}

/** The person tapped the fixed line. Answered at once when a fetch has just run, else by the next one. */
export function noteWakeTap(now = Date.now()): void {
  tappedAt = now;
  settle(now, false);
}

function settle(now: number, drained: boolean): void {
  if (tappedAt === null) return;
  if (now - tappedAt > TAP_WAIT_MS) {
    tappedAt = null;
    return;
  }
  const since = tappedAt - RECENT_MS;
  const found = new Map<string, ServerNotification>();
  for (const { at, notice } of recent) if (at >= since) found.set(notice.id, notice);
  if (found.size === 0 && !drained) return;
  tappedAt = null;
  // Several notices have no one screen between them, so the app stays where it is.
  if (found.size === 1) onLead?.([...found.values()][0]);
}

/** For tests. */
export function resetWakeAlerts(): void {
  recent = [];
  tappedAt = null;
  onLead = null;
}
