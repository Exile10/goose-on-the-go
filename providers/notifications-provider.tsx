import { api } from '@/services/api-client';
/**
 * NotificationsProvider — live server notifications for the paired Pond.
 *
 * While the app is in the foreground and a session token exists, this keeps
 * an SSE connection to `GET /api/v1/notifications/stream` (see
 * `services/notification-stream.ts`). Notifications queued while the phone
 * was away are flushed by the server on connect, so nothing is lost between
 * sessions. Background/killed-state delivery is the server's FCM/APNs relay
 * (still stubbed server-side) — out of scope here.
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
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { chatRuns } from '@/services/chat-runs';
import { getInstallId } from '@/services/install-id';
import {
  NotificationStream, NotificationDeduplicator,
  type ServerNotification,
} from '@/services/notification-stream';
import { registerPushToken, watchPushTokenRotation } from '@/services/push-token';
import { announceTurn } from '@/services/reply-notices';
import {
  configureLocalNotifications,
  presentLocally,
  watchLinkTaps,
} from '@/services/local-notifications';
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
  const { serverUrl, token, online, recover, revoke } = useServer();
  const deduplicator = useMemo(() => new NotificationDeduplicator(), []);
  const [notifications, setNotifications] = useState<ServerNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const streamRef = useRef<NotificationStream | null>(null);

  useEffect(() => {
    if (!token || !serverUrl || !online) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const startStream = async () => {
      const deviceId = await getInstallId();
      if (cancelled || AppState.currentState !== 'active') return;
      const stream = new NotificationStream({
        baseUrl: serverUrl,
        deduplicator,
        deviceId,
        token,
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
        onNotification: (n) => {
          setNotifications((prev) => [n, ...prev].slice(0, MAX_KEPT));
          setUnreadCount((prev) => prev + 1);
          // Presentation is the phone's own notification shade. There is no
          // in-app banner: a second, app-only copy of the same notice was one
          // more thing to dismiss and it disappeared the moment the app did.
          void presentLocally(n);
        },
      });
      streamRef.current = stream;
      stream.start();
    };

    void startStream();

    // Channels and the foreground handler, so a streamed notification can reach
    // the phone's shade rather than living and dying inside the app.
    void configureLocalNotifications();

    // Background push (Path B): register the native FCM/APNs token with the
    // paired server and keep it fresh across platform rotations. No-ops
    // cleanly where push is unavailable (Expo Go, simulators, permission
    // denied) — foreground SSE above works regardless.
    registerPushToken().catch((e) => console.log('[push] registration failed:', e));
    const stopTokenWatch = watchPushTokenRotation();

    // The stream only needs to live while the app is foregrounded; RN kills
    // long-lived sockets in the background anyway, and the server re-flushes
    // undelivered notifications on the next connect.
    const onAppState = (state: AppStateStatus) => {
      if (state === 'active') {
        streamRef.current?.stop();
        void startStream();
      } else {
        streamRef.current?.stop();
      }
    };
    const sub = AppState.addEventListener('change', onAppState);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      sub.remove();
      stopTokenWatch();
      streamRef.current?.stop();
      streamRef.current = null;
    };
  }, [serverUrl, token, online, recover, deduplicator]);

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
