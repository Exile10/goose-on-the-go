/**
 * Reads the Pond's wake ping out of a push, wherever the platform put it.
 *
 * The Pond's push carries no notice text, only `{ wake: "1", notification_id, category }`
 * (`wake_message` in the Pond's `fcm_push_relay.rs`, `wake_payload` in its `apns_push_relay.rs`).
 * Android gets it as a data-only message. An iPhone gets it under one fixed line, because iOS
 * drops silent pushes for an app the person swiped away. Anything else, including a tap on one
 * of the app's own notices, is not a wake ping.
 */

export interface WakePing {
  notificationId: string;
  category: string;
  /** iOS already drew the Pond's fixed line for it, so nothing needs to stand in for the alert. */
  visible?: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The push's own fields. A background task gets them under `data` on both platforms; iOS also
 * puts them at the top of the payload beside `aps`, and expo-notifications copies a `body`
 * field into `dataString`.
 */
export function wakeFields(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) return {};
  const data = isRecord(payload.data) ? payload.data : {};
  let parsed: Record<string, unknown> = {};
  if (typeof data.dataString === 'string') {
    try {
      const value: unknown = JSON.parse(data.dataString);
      if (isRecord(value)) parsed = value;
    } catch {
      // Not JSON: the plain fields beside it still count.
    }
  }
  return { ...payload, ...parsed, ...data };
}

export function readWakePing(payload: unknown): WakePing | null {
  const { wake, notification_id: id, category, notification, aps } = wakeFields(payload);
  if (wake !== '1' || typeof id !== 'string' || !id) return null;
  const alert = isRecord(aps) ? aps.alert : undefined;
  const visible = isRecord(notification) || isRecord(alert) || typeof alert === 'string';
  return {
    notificationId: id,
    category: typeof category === 'string' ? category : 'info',
    ...(visible ? { visible: true as const } : {}),
  };
}

/**
 * The wake ping behind a notification in the shade or a tap on one, when it is the Pond's fixed
 * line rather than a notice. iOS keeps a remote notification's custom keys in its push trigger's
 * payload; `content.data` holds only a `body` key, which the Pond does not send.
 */
export function wakePingOfNotification(notification: unknown): WakePing | null {
  const request = isRecord(notification) ? notification.request : null;
  if (!isRecord(request)) return null;
  const trigger = request.trigger;
  const pushed = isRecord(trigger) && trigger.type === 'push' && isRecord(trigger.payload) ? trigger.payload : {};
  const content = isRecord(request.content) ? request.content : {};
  return readWakePing({ ...pushed, data: content.data });
}
