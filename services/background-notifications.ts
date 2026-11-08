/**
 * Registers the push wake-up task with expo-task-manager.
 *
 * The background task a push wake runs, defined when the bundle loads.
 * The OS may start the app only to run this, with no screen and no React tree,
 * so it is defined and registered from the entry file (`index.ts`) before the
 * router loads, as expo-notifications requires. In Expo Go there is no
 * notifications module (`services/notifications-module.ts`) and nothing to wake.
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
 *
 * While the app is open the notification stream already delivers the alert, and
 * pulling it as well would show it a second time, so the task leaves it alone.
 * When the restored session reaches no Pond, the wake ping's own pull
 * (`services/wake-handler.ts`) tries the home addresses directly, and shows a
 * stand-in when it cannot reach one either.
 */

import { AppState, Platform } from 'react-native';

import { api } from './api-client';
import { stayConnectedEnabled } from './background-connection';
import { notifications, type NotificationsModule } from './notifications-module';
import { alreadyDelivered } from './notification-delivery';
import { handleWake } from './notification-wake';
import { ensurePondSession } from './pond-session';
import { pauseRemoteAccess, resumePausedRemoteAccess } from './remote-access';
import { handleWakePing, type WakeOutcome } from './wake-handler';
import { readWakePing } from './wake-ping';

export const WAKE_TASK = 'giap-notification-wake';

/** Read afresh each time: the person may open the app while a wake-up is under way. */
const appActive = () => AppState.currentState === 'active';

/**
 * expo-task-manager, or null where its native side is not in this build.
 *
 * This file is imported for its side effect from `index.ts`, ahead of expo-router, so an import
 * that throws takes the whole app down before a screen mounts. A development build made before
 * this dependency landed does exactly that: `Cannot find native module 'ExpoTaskManager'`, and
 * the app shows a red box instead of itself. The wake-up is one capability and the app is the
 * app, so a build without the module says so and carries on. Rebuilding the dev client restores
 * it; a release build always has it, because the dependency is in `package.json`.
 */
function loadTaskManager(): typeof import('expo-task-manager') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-task-manager') as typeof import('expo-task-manager');
  } catch {
    console.warn('[wake] expo-task-manager is not in this build: the push wake-up is off until the dev client is rebuilt');
    return null;
  }
}

const TaskManager = loadTaskManager();

export function defineWakeTask(Notifications: NotificationsModule | null = notifications): void {
  // Expo Go has no expo-notifications (see notifications-module.ts) and web has no push.
  if (!Notifications || !TaskManager || (Platform.OS !== 'android' && Platform.OS !== 'ios')) return;
  const { NewData, NoData, Failed } = Notifications.BackgroundNotificationTaskResult;
  const result: Record<WakeOutcome, number> = { pulled: NewData, nothing: NoData, unreachable: Failed };
  TaskManager.defineTask(WAKE_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[wake] task error', { kind: 'notification_wake', error: error.message });
      return Failed;
    }
    if (appActive()) return NoData;
    // The node was paused when the app left the foreground; a Pond away from home is reached through it.
    await resumePausedRemoteAccess();
    try {
      const outcome = await handleWake(data, { ensureSession: ensurePondSession, client: api });
      if (outcome === 'delivered') return NewData;
      if (outcome === 'ignored') return NoData;
      const ping = readWakePing(data);
      if (!ping) return outcome === 'failed' ? Failed : NoData;
      // A pass that ran out of time may already have shown this alert, which a stand-in would replace.
      if (alreadyDelivered(ping.notificationId)) return NewData;
      return result[await handleWakePing(ping)];
    } finally {
      // Paused again once the notice is shown, or a single wake-up would leave the node and its
      // foreground service running until the app is next opened.
      if (!appActive() && !stayConnectedEnabled()) await pauseRemoteAccess();
    }
  });
  Notifications.registerTaskAsync(WAKE_TASK).catch((e: unknown) => {
    console.warn('[wake] task could not be registered', { kind: 'notification_wake', error: String(e) });
  });
}

defineWakeTask();
