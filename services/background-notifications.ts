/**
 * The background task a push wake runs, defined when the bundle loads.
 *
 * The OS may start the app only to run this, with no screen and no React tree,
 * so it is defined and registered from the entry file (`index.ts`) before the
 * router loads, as expo-notifications requires. In Expo Go there is no
 * notifications module (`services/notifications-module.ts`) and nothing to wake.
 *
 * While the app is open the notification stream already delivers the alert, and
 * pulling it as well would show it a second time, so the task leaves it alone.
 */

import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import { notifications, type NotificationsModule } from './notifications-module';
import { handleWakePing, type WakeOutcome } from './wake-handler';
import { readWakePing } from './wake-ping';

export const WAKE_TASK = 'giap-wake-ping';

export function defineWakeTask(Notifications: NotificationsModule | null = notifications): void {
  if (!Notifications) return;
  const { NewData, NoData, Failed } = Notifications.BackgroundNotificationTaskResult;
  const result: Record<WakeOutcome, number> = { pulled: NewData, nothing: NoData, unreachable: Failed };
  TaskManager.defineTask(WAKE_TASK, async ({ data }) => {
    const ping = readWakePing(data);
    if (!ping || AppState.currentState === 'active') return NoData;
    return result[await handleWakePing(ping)];
  });
  Notifications.registerTaskAsync(WAKE_TASK).catch((e) => {
    console.warn('[notifications] could not register the wake task', e);
  });
}
