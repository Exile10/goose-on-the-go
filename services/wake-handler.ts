/**
 * What a push wake does: reach the Pond and pull this phone's waiting alerts.
 *
 * Kept apart from the task registration (`services/background-notifications.ts`)
 * so it can be tested without a task manager. Never throws: it runs in a
 * background task, where nothing would catch it.
 */

import { pondForBackground } from './background-pond';
import { pullPendingNotifications } from './pull-notifications';
import type { WakePing } from './wake-ping';

export type WakeOutcome = 'pulled' | 'nothing' | 'unreachable';

export async function handleWakePing(ping: WakePing, connect = pondForBackground): Promise<WakeOutcome> {
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
