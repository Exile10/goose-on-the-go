/**
 * NotificationsProvider — live server notifications for the paired Pond.
 *
 * Three paths deliver a notice, and all of them end in
 * `services/notification-delivery.ts`, which shows each one once:
 *
 * - The SSE stream to `GET /api/v1/notifications/stream`, opened while the app
 *   is in the foreground and, on Android with "Stay connected in the background"
 *   on, kept open behind a foreground service after the user leaves
 *   (`services/background-connection.ts`).
 * - The push wake-up: the Pond sends a content-free FCM/APNs message and the
 *   phone fetches what is pending (`services/notification-wake.ts`). This is
 *   what covers a phone whose stream Android has paused, and all of iOS.
 *   While the app is in the background or closed, the Pond's FCM/APNs wake ping
 *   runs `services/background-notifications.ts` instead, which pulls the alert
 *   itself.
 * - The same pending fetch each time the app comes back to the foreground.
 *
 * Arrivals are presented in the phone's own notification shade
 * (`services/local-notifications.ts`) rather than as an in-app banner, so a
 * notice outlives the screen the user happened to be on. So is the phone's own
 * notice that a reply finished while nobody was reading it
 * (`services/reply-notices.ts`), which the Pond does not send.
 *
 * Exposes the received list (newest first, capped), an unread count, and
 * `markAllRead()` for the notifications UI.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, Platform } from 'react-native';

import { api } from '@/services/api-client';
import {
  connectLink,
  disconnectLink,
  loadStayConnectedPreference,
  noteNoEndpoint,
  onStayConnectedChange,
  setLinkOwner,
  shouldHoldStream,
  shouldRunService,
  startPresenceService,
  stayConnectedEnabled,
  stopPresenceService,
} from '@/services/background-connection';
import { chatRuns } from '@/services/chat-runs';
import { getInstallId } from '@/services/install-id';
import { drainPending, onDelivered } from '@/services/notification-delivery';
import type { ServerNotification } from '@/services/notification-stream';
import { registerPushToken, watchPushTokenRotation } from '@/services/push-token';
import { announceTurn } from '@/services/reply-notices';
import { configureLocalNotifications, watchLinkTaps } from '@/services/local-notifications';
import { useServer } from '@/providers/server-provider';

/** Newest notifications kept in memory for the UI. */
const MAX_KEPT = 50;

interface NotificationsContextValue {
  /** Newest first. */
  notifications: ServerNotification[];
  unreadCount: number;
  markAllRead: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

/** How long to wait before retrying a stream whose token refresh could not complete. */
const AUTH_RETRY_MS = 30_000;

export function NotificationsProvider({ children }: PropsWithChildren) {
  const { serverUrl, token, online, paired, recover, revoke, connectionState } = useServer();
  const [notifications, setNotifications] = useState<ServerNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [stayConnected, setStayConnected] = useState(stayConnectedEnabled);
  const [active, setActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    void loadStayConnectedPreference().then(setStayConnected);
    return onStayConnectedChange(setStayConnected);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);

  // Every delivery path reaches the in-app list, not only the stream.
  useEffect(() => onDelivered((n) => {
    setNotifications((prev) => [n, ...prev].slice(0, MAX_KEPT));
    setUnreadCount((prev) => prev + 1);
  }), []);

  // The foreground service. Started only while the app is in front, because Android 12 and
  // later refuse to start one from the background; stopped on unpair or when the setting is off.
  // Not stopped on unmount: the activity going away is exactly when it has to stay.
  useEffect(() => {
    if (shouldRunService({ platform: Platform.OS, paired, enabled: stayConnected })) {
      if (active) void startPresenceService();
    } else {
      void stopPresenceService();
    }
  }, [paired, stayConnected, active]);

  // With no endpoint there is no stream to report on, so the background notice hears it from
  // the connection manager: still looking, or found nothing.
  useEffect(() => {
    if (!serverUrl || !online) noteNoEndpoint(connectionState === 'reconnecting');
  }, [serverUrl, online, connectionState]);

  const hold = shouldHoldStream({ platform: Platform.OS, paired, enabled: stayConnected, active });

  useEffect(() => {
    if (!token || !hold) { disconnectLink(); return; }
    // No endpoint right now: a stream already open keeps retrying with its own backoff, and the
    // next endpoint the connection manager finds reconnects it here.
    if (!serverUrl || !online) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const startStream = async () => {
      const deviceId = await getInstallId();
      if (cancelled) return;
      connectLink({ baseUrl: serverUrl, deviceId, token });
    };

    setLinkOwner({
      // Quiet, deliberately. A dropped stream is not evidence that the
      // transport is down -- the endpoint it just failed against may be
      // answering everything else perfectly -- and a loud recover publishes
      // "Reconnecting" before it has looked. When the stream fails in a loop,
      // as it does against a pond that has stopped accepting it, that is a
      // banner alternating between reconnecting and whatever the probe found,
      // several times a second. A quiet pass still switches endpoints if it
      // needs to; it just does not narrate.
      onDisconnect: () => { void recover(true); },
      // A refused stream that a refresh cannot rescue is the Pond saying it
      // no longer knows this phone. Reported rather than logged: it used to
      // warn to the console and leave the stream reconnecting into the same
      // 401, which is what made the banner alternate between connected and
      // reconnecting for as long as the app was open.
      onAuthFailure: () => {
        void api
          .refreshAuthentication()
          .then((ok) => (ok ? void recover() : revoke()))
          // A refresh that could not complete -- rate limited, Pond restarting,
          // no network -- is not a refusal. Try the stream again later; a real
          // refusal on that attempt still ends here as a revoke.
          .catch(() => {
            if (cancelled) return;
            retryTimer = setTimeout(() => { retryTimer = null; if (!cancelled) void startStream(); }, AUTH_RETRY_MS);
          });
      },
    });

    if (active) {
      // Coming back to the front: a stream held through the background may be wedged behind Doze,
      // so it starts afresh, and whatever the Pond holds that no path delivered is fetched once.
      disconnectLink();
      drainPending(api, 'foreground').catch((e: unknown) => {
        console.warn('[notifications] pending fetch failed', { kind: 'notification_pending', source: 'foreground', error: String(e) });
      });
    }
    void startStream();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      // The stream is left open: the next run of this effect decides whether it stays, and an
      // unmount while the service holds the process is when it must.
      setLinkOwner(null);
    };
    // `revoke` is a fresh function on every connection change; the owner reads it when it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, token, online, hold, active, recover]);

  useEffect(() => {
    if (!token || !serverUrl || !online) return;
    // Channels and the foreground handler, so a streamed notification can reach
    // the phone's shade rather than living and dying inside the app.
    void configureLocalNotifications();

    // Background push: register the native FCM/APNs token with the paired
    // server and keep it fresh across platform rotations. No-ops cleanly where
    // push is unavailable (Expo Go, simulators, permission denied) -- the
    // stream works regardless.
    registerPushToken().catch((e) => console.log('[push] registration failed:', e));
    return watchPushTokenRotation();
  }, [serverUrl, token, online]);

  // Taps work whether or not a Pond is reachable: a link goes to Uber or a maps app, a screen opens here.
  useEffect(() => watchLinkTaps(), []);

  // The Pond says nothing when a turn ends, so the phone says it, to whoever was not reading.
  useEffect(() => chatRuns.onAnnounce((notice) => void announceTurn(notice)), []);

  const markAllRead = useCallback(() => setUnreadCount(0), []);

  const value = useMemo<NotificationsContextValue>(
    () => ({ notifications, unreadCount, markAllRead }),
    [notifications, unreadCount, markAllRead],
  );

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  );
}

/**
 * Access live server notifications.
 * Must be called within a `<NotificationsProvider>`.
 */
export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within a <NotificationsProvider>');
  }
  return ctx;
}
