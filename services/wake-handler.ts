/**
 * What a push wake does: reach the Pond and pull this phone's waiting alerts.
 *
 * When the Pond cannot be reached (the phone is away and the remote link is not
 * up, #50), a notice that says only that something happened takes the alert's
 * place in the shade. It carries nothing the push did not, and it is filed under
 * the alert's own id, so the real one replaces it once the app pulls it.
 *
 * Kept apart from the task registration (`services/background-notifications.ts`)
 * so it can be tested without a task manager. Never throws: it runs in a
 * background task, where nothing would catch it.
 */

import { pondForBackground } from './background-pond';
import i18n from './i18n';
import { presentLocally } from './local-notifications';
import type { ServerNotification } from './notification-stream';
import { pullPendingNotifications } from './pull-notifications';
import type { WakePing } from './wake-ping';

export type WakeOutcome = 'pulled' | 'nothing' | 'unreachable';

export async function handleWakePing(ping: WakePing, connect = pondForBackground): Promise<WakeOutcome> {
  const outcome = await pull(ping, connect);
  // An iPhone's wake is already a line in the shade, which says as much as the stand-in would.
  if (outcome === 'unreachable' && !ping.visible) await presentLocally(standIn(ping));
  return outcome;
}

/** The content-free notice shown in the alert's place. */
export function standIn(ping: WakePing, now = new Date()): ServerNotification {
  const urgent = ping.category === 'alert' || ping.category === 'action_required';
  return {
    id: ping.notificationId,
    target: '',
    category: ping.category,
    title: i18n.t(urgent ? 'notifications.wake.alertTitle' : 'notifications.wake.updateTitle'),
    body: i18n.t('notifications.wake.body'),
    timestamp: now.toISOString(),
  };
}

async function pull(ping: WakePing, connect: typeof pondForBackground): Promise<WakeOutcome> {
  try {
    const pond = await connect();
    if (!pond) return 'unreachable';
    // Nothing waiting is normal: the open stream may already have delivered it.
    return (await pullPendingNotifications(pond)) > 0 ? 'pulled' : 'nothing';
  } catch (e) {
    console.warn('[notifications] could not pull after a wake', ping.notificationId, e);
    return 'unreachable';
  }
}
