/**
 * Puts server notifications in the phone's own notification shade.
 *
 * The SSE stream (`services/notification-stream.ts`) only delivers while the
 * app is connected. Before this, a streamed notice was drawn as an in-app
 * banner and nowhere else, so a "Failed pairing attempt" left no trace the
 * moment the banner was dismissed or the user switched away — there was nothing
 * to go back and read, which is not how any other app on the phone behaves.
 *
 * Presenting each one locally puts it where the user already looks for
 * notifications and leaves it there until they clear it, which is why the
 * in-app banner is gone rather than sitting alongside this.
 *
 * This is deliberately separate from `services/push-token.ts`, which registers
 * for *remote* pushes the server sends when the app is not running. The two
 * meet at `identifier`: both use the server's notification id, so a
 * notification delivered over both paths replaces itself rather than appearing
 * twice.
 */

import type { NotificationResponse } from 'expo-notifications';
import { notifications, type NotificationsModule } from './notifications-module';
import { Linking, Platform } from 'react-native';

import { router } from 'expo-router';

import { linkFromData, openRouteFromData, rideOfferFromData, screenPath } from './notification-link';
import type { ServerNotification } from './notification-stream';

/**
 * Android groups notifications by channel, and the channel — not the individual
 * notification — decides whether one may interrupt. Two channels, because a
 * security alert and a schedule result should not arrive the same way.
 */
const ALERT_CHANNEL = 'giap-alerts';
/**
 * Updates (schedule results, pairings, reminders) at HIGH importance, so they
 * pop up as a heads-up banner: Android shows one only for a HIGH channel. The
 * first Updates channel, `giap-info`, was DEFAULT, and Android never lets an app
 * raise an existing channel's importance (the user owns it once created), so
 * the HIGH one needs a new id and the old one is deleted.
 */
const INFO_CHANNEL = 'giap-info-v2';
/** The DEFAULT-importance Updates channel that installs made before `giap-info-v2`. */
const RETIRED_INFO_CHANNEL = 'giap-info';

/** Categories that warrant a heads-up rather than a quiet shade entry. */
const URGENT = new Set(['alert', 'action_required']);

let configured: Promise<void> | null = null;

/**
 * Show foreground notifications in the shade.
 *
 * Without a handler, expo-notifications suppresses a notification that arrives
 * while the app is in the foreground — which is precisely when the SSE stream
 * is delivering, so nothing would ever reach the shade.
 */
function installHandler(Notifications: NotificationsModule): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, // Heads-up, the same as when the app is closed.
      shouldShowList: true, // And it stays in the shade to be read later.
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function createChannels(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(ALERT_CHANNEL, {
    name: 'Security alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
  await Notifications.setNotificationChannelAsync(INFO_CHANNEL, {
    name: 'Updates',
    importance: Notifications.AndroidImportance.HIGH,
  });
  // Deleting a channel that was never created is a no-op, so a fresh install is fine.
  await Notifications.deleteNotificationChannelAsync(RETIRED_INFO_CHANNEL);
}

/**
 * Prepare the notification channels and handler. Safe to call repeatedly — the
 * work happens once and every later caller awaits the same promise.
 */
export function configureLocalNotifications(): Promise<void> {
  const Notifications = notifications;
  if (!Notifications) return Promise.resolve(); // Expo Go: see notifications-module.ts
  if (!configured) {
    installHandler(Notifications);
    configured = createChannels(Notifications).catch((e) => {
      // A channel that cannot be created costs the shade entry, not the app.
      console.warn('[notifications] could not create channels', e);
    });
  }
  return configured;
}

/**
 * Put one server notification in the shade.
 *
 * Failure is logged rather than thrown: the caller is a stream handler, and a
 * notification that could not be presented must not take the stream down with
 * it. It is still kept in the provider's list either way. Resolves whether it
 * reached the shade, for a caller that must not acknowledge one that did not.
 */
export async function presentLocally(notification: ServerNotification): Promise<boolean> {
  try {
    await configureLocalNotifications();
    const Notifications = notifications;
    if (!Notifications) return false; // Expo Go: see notifications-module.ts
    await Notifications.scheduleNotificationAsync({
      // The server's own id, so the same notification arriving over both the
      // stream and a remote push replaces itself instead of duplicating.
      identifier: notification.id,
      content: {
        title: notification.title,
        body: notification.body,
        // A link, a ride offer or a screen to open rides along, already checked, for the tap to act on.
        data: {
          id: notification.id,
          category: notification.category,
          ...linkData(notification.data),
        },
      },
      // Android routes by channel, and the channel is carried on the trigger —
      // `NotificationContentInput` has no `channelId`, so a channel set there is
      // silently dropped and every notification lands on the default channel.
      // A bare `{ channelId }` is the immediate, channel-aware trigger.
      trigger:
        Platform.OS === 'android'
          ? { channelId: URGENT.has(notification.category) ? ALERT_CHANNEL : INFO_CHANNEL }
          : null, // iOS has no channels; null is immediate.
    });
    return true;
  } catch (e) {
    console.warn('[notifications] could not present', notification.id, e);
    return false;
  }
}

/**
 * The fields to store on a shade notification for its tap: a link or a ride
 * offer, and a screen to open. Empty when it carries none of them.
 */
function linkData(data: unknown): Record<string, unknown> {
  return { ...actionData(data), ...openData(data) };
}

function actionData(data: unknown): Record<string, unknown> {
  const link = linkFromData(data);
  if (link) return { action: 'open_url', kind: link.kind, url: link.url, label: link.label };
  const offer = rideOfferFromData(data);
  return offer ? { action: 'ride_offer', provider: offer.provider, dropoff: offer.dropoff } : {};
}

function openData(data: unknown): Record<string, unknown> {
  const route = openRouteFromData(data);
  if (!route) return {};
  if (route.open !== 'schedule') return { open: route.open };
  return {
    open: route.open,
    ...(route.scheduleId ? { schedule_id: route.scheduleId } : {}),
    ...(route.runId ? { run_id: route.runId } : {}),
  };
}

/** Notifications whose tap has been handled in this JS session, by identifier. */
const handledTaps = new Set<string>();

/** Act on a tapped notification, checking what it carries again first. */
function openTapped(Notifications: NotificationsModule, response: NotificationResponse | null): void {
  if (!response) return;
  // The listener and the read of the last response can both deliver one tap; it opens once.
  const id = response.notification.request.identifier;
  if (handledTaps.has(id)) return;
  handledTaps.add(id);
  // expo-notifications keeps the last response for as long as its native module lives, so
  // one left in place would reopen its link on every later mount, with no tap at all.
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    // Not available on this platform; the identifier check still covers this session.
  }
  const data = response.notification.request.content.data;
  const offer = rideOfferFromData(data);
  if (offer) {
    const { name, latitude, longitude } = offer.dropoff;
    router.push({
      pathname: '/ride',
      params: { name, latitude: String(latitude), longitude: String(longitude), provider: offer.provider },
    });
    return;
  }
  const link = linkFromData(data);
  if (link) {
    Linking.openURL(link.url).catch((e) => {
      // No app and no browser can take it; the notification itself still says where to.
      console.warn('[notifications] could not open link', e);
    });
    return;
  }
  const route = openRouteFromData(data);
  if (route) router.push(screenPath(route));
}

/**
 * Open ride and directions links, the ride screen for a ride offer, and the
 * schedules, devices or chat screen the Pond names, when their notification is
 * tapped, including the tap that launched the app.
 * Returns the unsubscribe.
 */
export function watchLinkTaps(): () => void {
  const Notifications = notifications;
  if (!Notifications) return () => {}; // Expo Go: see notifications-module.ts
  const sub = Notifications.addNotificationResponseReceivedListener((response) => openTapped(Notifications, response));
  Notifications.getLastNotificationResponseAsync()
    .then((response) => openTapped(Notifications, response))
    .catch(() => {});
  return () => sub.remove();
}
