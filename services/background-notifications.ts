/**
 * Registers the push wake-up task with expo-task-manager.
 *
 * Imported for its side effect from `index.ts`, ahead of expo-router, because
 * a headless start loads the bundle without mounting any screen: a task defined
 * inside the React tree would not exist when Android runs it. Defining and
 * registering at module scope is what expo-notifications asks for.
 *
 * Android delivers data-only FCM messages to the task in the foreground, in the
 * background and with the app closed; expo-notifications does not draw anything
 * for them itself, so the notice the user sees is the one fetched from the Pond.
 * iOS needs `content-available: 1` on the APNs payload and the
 * `remote-notification` background mode (set in app.json), and decides itself
 * how often to honour it.
 */

import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { api } from './api-client';
import { notifications } from './notifications-module';
import { handleWake } from './notification-wake';
import { ensurePondSession } from './pond-session';

export const WAKE_TASK = 'giap-notification-wake';

const Notifications = notifications;
// Expo Go has no expo-notifications (see notifications-module.ts) and web has no push.
if (Notifications && (Platform.OS === 'android' || Platform.OS === 'ios')) {
  TaskManager.defineTask(WAKE_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[wake] task error', { kind: 'notification_wake', error: error.message });
      return Notifications.BackgroundNotificationTaskResult.Failed;
    }
    const outcome = await handleWake(data, { ensureSession: ensurePondSession, client: api });
    if (outcome === 'delivered') return Notifications.BackgroundNotificationTaskResult.NewData;
    if (outcome === 'failed') return Notifications.BackgroundNotificationTaskResult.Failed;
    return Notifications.BackgroundNotificationTaskResult.NoData;
  });
  Notifications.registerTaskAsync(WAKE_TASK).catch((e: unknown) => {
    console.warn('[wake] task could not be registered', { kind: 'notification_wake', error: String(e) });
  });
}
