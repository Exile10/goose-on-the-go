/**
 * expo-notifications, or null where it cannot be loaded.
 *
 * Since SDK 53, Expo Go on Android throws as soon as expo-notifications is
 * imported: push notifications were taken out of it. A top-level import in
 * either notification service therefore failed while the root layout loaded,
 * and Expo Go showed nothing but the error. Insecure development mode exists
 * for Expo Go (`services/dev-mode.ts`), so the module is loaded here, once,
 * and not at all in Expo Go. Push and the notification shade are simply off
 * there; the foreground stream still delivers notifications to the app.
 * Development and release builds load it exactly as before.
 */

import Constants, { ExecutionEnvironment } from 'expo-constants';

export type NotificationsModule = typeof import('expo-notifications');

function load(): NotificationsModule | null {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    console.warn('[notifications] unavailable in Expo Go: push and the notification shade are off');
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-notifications') as NotificationsModule;
}

/** The module, or null in Expo Go. Read it once per call and stop when it is null. */
export const notifications = load();
