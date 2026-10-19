/**
 * The link a Pond notification asks the phone to open: a ride in Uber, or
 * directions in a maps app.
 *
 * The Pond puts it in `Notification.data` as
 * `{ action: "open_url", kind: "ride" | "directions", url, label }`. Only
 * https links on the hosts below are accepted, so a notification can open the
 * ride or maps app and nothing else. The check runs twice: when the
 * notification arrives, and again when it is tapped, because the tap reads
 * back data that has been stored in the phone's notification shade.
 */

/** Hosts whose links open Uber, Google Maps or Apple Maps. */
const ALLOWED_HOSTS = new Set(['m.uber.com', 'www.google.com', 'maps.apple.com']);

export type LinkKind = 'ride' | 'directions';

export interface NotificationLink {
  kind: LinkKind;
  url: string;
  /** Shown as the notification's call to action, e.g. "Open Uber". */
  label: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The URL if it is https on an allowed host, else null. */
export function allowedUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  // Google's host serves far more than maps; only its directions path is a maps link.
  if (parsed.hostname === 'www.google.com' && !parsed.pathname.startsWith('/maps')) return null;
  // What was checked is the parse, so the parse is what gets stored and opened. iOS reads
  // a backslash differently: `https://m.uber.com\@evil.example/` passes here as m.uber.com,
  // and opened as written it goes to evil.example.
  return parsed.href;
}

/** The link in a notification's `data`, or null when it carries none or one we refuse. */
export function linkFromData(data: unknown): NotificationLink | null {
  if (!isRecord(data) || data.action !== 'open_url') return null;
  const url = allowedUrl(data.url);
  if (!url) return null;
  const kind: LinkKind = data.kind === 'ride' ? 'ride' : 'directions';
  const label =
    typeof data.label === 'string' && data.label.trim()
      ? data.label.trim()
      : kind === 'ride'
        ? 'Open ride'
        : 'Open directions';
  return { kind, url, label };
}

/**
 * A ride the Pond offers after a member asked for one: where to, and with which company.
 * Sent as `{ action: "ride_offer", provider, dropoff: { name, latitude, longitude }, label }`.
 * Nothing is booked by it; the ride screen asks for a fare from the phone's own location.
 */
export interface RideOffer {
  provider: string;
  dropoff: { name: string; latitude: number; longitude: number };
}

function onEarth(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
  );
}

/** The ride offer in a notification's `data`, or null when it carries none or a malformed one. */
export function rideOfferFromData(data: unknown): RideOffer | null {
  if (!isRecord(data) || data.action !== 'ride_offer' || !isRecord(data.dropoff)) return null;
  const { name, latitude, longitude } = data.dropoff;
  if (typeof name !== 'string' || !name.trim() || !onEarth(latitude, longitude)) return null;
  const provider = typeof data.provider === 'string' && data.provider ? data.provider : 'uber';
  return { provider, dropoff: { name: name.trim(), latitude, longitude: longitude as number } };
}

/**
 * The app screen a Pond notification asks a tap to open. The Pond puts it in
 * `Notification.data` as `{ open: "schedule", schedule_id, run_id }`,
 * `{ open: "devices" }` or `{ open: "chat" }`.
 *
 * Only these three screens are accepted, and only ids of the shape the Pond
 * mints, so a notification can open one of them and nothing else. An older Pond
 * sends no `open`, and the tap opens the app where it was, as before.
 */
export type OpenRoute =
  | { open: 'schedule'; scheduleId?: string; runId?: string }
  | { open: 'devices' }
  | { open: 'chat' };

/** A Pond id: a UUID, optionally prefixed (`timer-...`). Nothing that could be a path. */
const POND_ID = /^[A-Za-z0-9_-]{1,128}$/;

function pondId(raw: unknown): string | undefined {
  return typeof raw === 'string' && POND_ID.test(raw) ? raw : undefined;
}

/**
 * The screen in a notification's `data`, or null when it names none or one we
 * do not open. A malformed schedule or run id is dropped, not the screen: the
 * schedules list is still the right place to land.
 */
export function openRouteFromData(data: unknown): OpenRoute | null {
  if (!isRecord(data)) return null;
  switch (data.open) {
    case 'schedule': {
      const route: OpenRoute = { open: 'schedule' };
      const scheduleId = pondId(data.schedule_id);
      const runId = pondId(data.run_id);
      if (scheduleId) route.scheduleId = scheduleId;
      if (runId) route.runId = runId;
      return route;
    }
    case 'devices':
      return { open: 'devices' };
    case 'chat':
      return { open: 'chat' };
    default:
      return null;
  }
}

/** Where a route opens: an expo-router path, with the schedule's id when it names one. */
type ScreenHref =
  | '/(stack)/schedule'
  | { pathname: '/(stack)/schedule'; params: { schedule_id: string } }
  | '/(tabs)/devices'
  | '/(tabs)/chat';

/**
 * The expo-router location a route opens. A schedule notification names the
 * schedule that ran, so the list is opened with its `schedule_id` and can go on
 * to that schedule. The id is already one `openRouteFromData` accepted; without
 * one the list opens as it is. A list that does not read the param ignores it.
 */
export function screenPath(route: OpenRoute): ScreenHref {
  switch (route.open) {
    case 'schedule':
      return route.scheduleId
        ? { pathname: '/(stack)/schedule', params: { schedule_id: route.scheduleId } }
        : '/(stack)/schedule';
    case 'devices':
      return '/(tabs)/devices';
    case 'chat':
      return '/(tabs)/chat';
  }
}
