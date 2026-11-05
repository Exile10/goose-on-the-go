/**
 * The one place a server notification becomes something the user sees.
 *
 * Three paths deliver notices from the Pond: the SSE stream while the app is
 * open or the background connection holds it, the push wake-up that fetches
 * `GET /api/v1/notifications/pending`, and the same fetch when the app comes
 * back to the foreground. They overlap on purpose, so each one hands its notice
 * here rather than presenting it itself:
 *
 * - one deduplicator for the whole JavaScript runtime, so a notice that arrives
 *   over the stream and then again in the pending list is shown once;
 * - `presentLocally` with the server's id as the identifier, so even across
 *   runtimes (a headless wake-up, then the app) the shade replaces rather than
 *   duplicates;
 * - an acknowledgement to the Pond, so it stops holding the notice for the next
 *   wake-up to fetch again.
 */

import type { PondApiClient } from './api-client';
import { presentLocally } from './local-notifications';
import { NotificationDeduplicator, type ServerNotification } from './notification-stream';
import { withEventTime } from './pull-notifications';

/** Shared by every delivery path in this runtime. */
const deliveryDeduplicator = new NotificationDeduplicator();

type Listener = (notification: ServerNotification) => void;
const listeners = new Set<Listener>();

/** Hear about each notice as it is delivered, for the in-app list. Returns the unsubscribe. */
export function onDelivered(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The API surface delivery needs; the shared client in the app, a fake in tests. */
export type DeliveryClient = Pick<PondApiClient, 'pendingNotifications' | 'ackNotification'>;

/** A pending item in the stream's shape, or null when it is not one. */
export function readNotification(raw: unknown): ServerNotification | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== 'string' || !item.id) return null;
  if (typeof item.title !== 'string' || typeof item.body !== 'string') return null;
  return {
    id: item.id,
    target: typeof item.target === 'string' ? item.target : '',
    category: typeof item.category === 'string' ? item.category : 'info',
    title: item.title,
    body: item.body,
    timestamp: typeof item.timestamp === 'string' ? item.timestamp : '',
    data: item.data,
  };
}

/**
 * Acknowledge one notice. Never throws: a lost acknowledgement means the Pond
 * offers the notice again, and the deduplicator and the shared identifier keep
 * that from showing twice.
 */
export async function acknowledge(client: DeliveryClient, id: string, source: string): Promise<boolean> {
  try {
    await client.ackNotification(id);
    return true;
  } catch (e) {
    console.warn('[notifications] ack failed', { kind: 'notification_ack', source, id, error: String(e) });
    return false;
  }
}

/** Whether this runtime has already put this notice in front of the user. */
export function alreadyDelivered(id: string): boolean {
  return deliveryDeduplicator.has(id);
}

async function show(notification: ServerNotification, shade: ServerNotification): Promise<'repeat' | 'shown' | 'refused'> {
  if (!deliveryDeduplicator.accept(notification.id)) return 'repeat';
  for (const listener of listeners) {
    try {
      listener(notification);
    } catch (e) {
      console.warn('[notifications] delivery listener failed', { kind: 'notification_listener', error: String(e) });
    }
  }
  return (await presentLocally(shade)) ? 'shown' : 'refused';
}

/**
 * Show one notice, unless this runtime has already shown it. Returns whether it
 * was new. Does not acknowledge; the caller decides when.
 */
export async function deliver(notification: ServerNotification): Promise<boolean> {
  return (await show(notification, notification)) !== 'repeat';
}

/**
 * Show one notice if this runtime has not shown it, then acknowledge it either
 * way. The Pond holds a phone's notice until it is acknowledged, and re-sends
 * every unacknowledged one on each new stream connection and in each pending
 * list: a repeat that was already shown still needs its acknowledgement, since
 * the first one may have been lost, or it is offered again every time.
 */
export async function deliverAndAcknowledge(
  client: DeliveryClient,
  notification: ServerNotification,
  source: string,
): Promise<{ presented: boolean; acked: boolean }> {
  const presented = await deliver(notification);
  const acked = await acknowledge(client, notification.id, source);
  return { presented, acked };
}

/** What one fetch of the pending list did, for the caller's log line and for tests. */
export interface DrainResult { fetched: number; presented: number; acked: number }

/**
 * Fetch the notices the Pond is holding for this phone, show the new ones with
 * the time each happened, and acknowledge every one -- including those already
 * shown, which the Pond would otherwise keep offering. Throws only when the
 * fetch itself fails.
 */
export async function drainPending(client: DeliveryClient, source: 'wake' | 'foreground'): Promise<DrainResult> {
  const raw = await client.pendingNotifications();
  const result: DrainResult = { fetched: raw.length, presented: 0, acked: 0 };
  for (const item of raw) {
    const notification = readNotification(item);
    if (!notification) {
      console.warn('[notifications] pending item ignored: not a notification', { kind: 'notification_pending', source });
      continue;
    }
    const outcome = await show(notification, withEventTime(notification));
    // After a wake-up the shade is the only place a notice shows, so one it refused stays with
    // the Pond for the next wake. In the foreground the in-app list already has it.
    if (outcome === 'refused' && source === 'wake') {
      deliveryDeduplicator.forget(notification.id);
      continue;
    }
    if (outcome !== 'repeat') result.presented++;
    if (await acknowledge(client, notification.id, source)) result.acked++;
  }
  console.info('[notifications] pending drained', { kind: 'notification_pending', source, ...result });
  return result;
}
