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

import { getInstallId } from '@/services/install-id';
import {
  NotificationStream,
  type ServerNotification,
} from '@/services/notification-stream';
import { registerPushToken, watchPushTokenRotation } from '@/services/push-token';
import { useServer } from '@/providers/server-provider';

/** Newest notifications kept in memory for the UI. */
const MAX_KEPT = 50;

interface NotificationsContextValue {
  /** Newest first. */
  notifications: ServerNotification[];
  unreadCount: number;
  /** The most recent notification, for transient banner display. */
  latest: ServerNotification | null;
  markAllRead: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: PropsWithChildren) {
  const { serverUrl, token } = useServer();
  const [notifications, setNotifications] = useState<ServerNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [latest, setLatest] = useState<ServerNotification | null>(null);
  const streamRef = useRef<NotificationStream | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const startStream = async () => {
      const deviceId = await getInstallId();
      if (cancelled) return;
      const stream = new NotificationStream({
        baseUrl: serverUrl,
        deviceId,
        token,
        onNotification: (n) => {
          setNotifications((prev) => [n, ...prev].slice(0, MAX_KEPT));
          setUnreadCount((prev) => prev + 1);
          setLatest(n);
        },
      });
      streamRef.current = stream;
      stream.start();
    };

    void startStream();

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
      sub.remove();
      stopTokenWatch();
      streamRef.current?.stop();
      streamRef.current = null;
    };
  }, [serverUrl, token]);

  const markAllRead = useCallback(() => {
    setUnreadCount(0);
    setLatest(null);
  }, []);

  const value = useMemo<NotificationsContextValue>(
    () => ({ notifications, unreadCount, latest, markAllRead }),
    [notifications, unreadCount, latest, markAllRead],
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
