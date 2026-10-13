/**
 * The Activity screen's reading of the Pond's activity log (issue #15).
 *
 * The wire type is `ActivityEvent` (`services/types.ts`): a category, a dotted
 * action such as `device.state_changed`, and tagged attributes. What is here turns
 * that into rows a household reads — which filter an event belongs to, its
 * icon, a line of text — plus the sample events the screen shows while its
 * Developer toggle is on mock.
 */

import type { TFunction } from 'i18next';

import type { IconName } from '@/constants/icons';
import { humanizeTool, toolWords } from '@/constants/tools';
import type { TranslationKey } from '@/services/i18n';
import type { ActivityEvent, AttributeValue, EventCategory, LogEntry } from '@/services/types';

/**
 * The filters, named for what a reader is looking for rather than for the
 * nine categories behind them: nobody looks for "inference", they look for
 * what Goose did.
 */
export type ActivityFilter = 'all' | 'action' | 'mcp' | 'home' | 'system' | 'error';

/** `error` is Problems: the Pond's operational log rather than its activity. */
export const ACTIVITY_FILTERS: ActivityFilter[] = ['all', 'action', 'mcp', 'home', 'system', 'error'];

/** Which filter a category falls under. Exhaustive, so a new category fails here until placed. */
export function filterOf(category: EventCategory): Exclude<ActivityFilter, 'all' | 'error'> {
  switch (category) {
    case 'agent':
    case 'inference':
      return 'action';
    case 'tool':
      return 'mcp';
    case 'sensor':
    case 'camera':
    case 'device':
      return 'home';
    case 'auth':
    case 'network':
    case 'system':
      return 'system';
  }
}

/** Every category, kept whole by the compiler: a `Record` literal missing one does not build. */
const CATEGORIES = Object.keys({
  agent: true,
  tool: true,
  inference: true,
  sensor: true,
  camera: true,
  device: true,
  auth: true,
  network: true,
  system: true,
} satisfies Record<EventCategory, true>) as EventCategory[];

/** The categories a filter spans, one Pond request each: `GET /activity` takes a single `category`. */
export function categoriesOf(filter: Exclude<ActivityFilter, 'all'>): EventCategory[] {
  return CATEGORIES.filter((c) => filterOf(c) === filter);
}

/**
 * Which filter an event falls under, or null for one shown under All only. The agent
 * category also carries the Pond's reading of who is about -- a member arriving or leaving
 * (`presence.*`), a conversation starting or going idle (`session.*`) -- which is not
 * something Goose did.
 */
export function eventFilter(event: ActivityEvent): Exclude<ActivityFilter, 'all'> | null {
  if (event.category === 'agent' && /^(presence|session)\./.test(event.action)) return null;
  return filterOf(event.category);
}

export function inFilter(event: ActivityEvent, filter: ActivityFilter): boolean {
  return filter === 'all' || eventFilter(event) === filter;
}

/**
 * The label for a filter, one literal key per branch: a key assembled at
 * runtime is invisible to the catalogue check in services/__tests__/i18n.test.ts.
 */
export function filterLabelKey(filter: ActivityFilter): TranslationKey {
  switch (filter) {
    case 'all':
      return 'activity.all';
    case 'action':
      return 'activity.action';
    case 'mcp':
      return 'activity.mcp';
    case 'home':
      return 'activity.home';
    case 'system':
      return 'activity.system';
    case 'error':
      return 'activity.error';
  }
}

export function categoryIcon(category: EventCategory): IconName {
  switch (category) {
    case 'agent':
      return 'agent';
    case 'inference':
      return 'cpu';
    case 'tool':
      return 'skills';
    case 'sensor':
      return 'sensor';
    case 'camera':
      return 'camera';
    case 'device':
      return 'device';
    case 'auth':
      return 'key';
    case 'network':
      return 'wifi';
    case 'system':
      return 'server';
  }
}

/** An attribute's value without its tag: `{"float": 21.5}` is `21.5`. */
export function attributeText(value: AttributeValue): string {
  if ('text' in value) return value.text;
  if ('int' in value) return String(value.int);
  if ('float' in value) return String(Math.round(value.float * 100) / 100);
  return String(value.bool);
}

/**
 * What a row is called, one literal key per action the Pond emits: its event
 * bus (`BusEvent::to_event`), a chat turn (`record_turn_activity`), the egress
 * gate, pairing and the security policy's audit. An action it adds later reads
 * as the catalogue's fallback until named here, never as its raw segment.
 */
export function eventTitleKey(action: string): TranslationKey {
  switch (action) {
    case 'agent.turn':
      return 'activity.event.agentTurn';
    case 'inference.completion':
      return 'activity.event.inference';
    case 'tool.call':
      return 'activity.event.toolCall';
    case 'sensor.reading':
      return 'activity.event.sensorReading';
    case 'camera.event':
      return 'activity.event.cameraEvent';
    case 'device.state_changed':
      return 'activity.event.deviceChanged';
    case 'time.tick':
      return 'activity.event.timeTick';
    case 'presence.profile':
      return 'activity.event.presence';
    case 'session.lifecycle':
      return 'activity.event.session';
    case 'egress.http':
      return 'activity.event.egress';
    case 'egress.denied':
      return 'activity.event.egressDenied';
    case 'auth.device_paired':
      return 'activity.event.devicePaired';
    case 'auth.pairing_verify_failed':
      return 'activity.event.pairingFailed';
    case 'security.audit':
      return 'activity.event.securityAudit';
    default:
      return 'activity.event.other';
  }
}

/**
 * Attributes that say which thing an event was about, in the order worth
 * showing, by the names the Pond's emitters give them. `unit` rides on
 * `value` rather than standing alone. `redacted` is the redactor's count of
 * what it removed, which is about the log rather than about the event.
 */
const SUBJECT_KEYS = [
  'device_name',
  'tool',
  'model',
  'device_id',
  'camera_id',
  'key',
  'event_type',
  'sensor_type',
  'host',
  'value',
];

/** One subject attribute as a row shows it. */
function subjectText(key: string, attributes: ActivityEvent['attributes'], t: TFunction): string {
  const text = attributeText(attributes[key]);
  if (key === 'tool') {
    const words = toolWords(text);
    return words ? t(words.label) : humanizeTool(text);
  }
  if (key === 'value' && attributes.unit) {
    // `bool` is the reading's type rather than a unit: a motion sensor's `1` stands alone.
    const unit = attributeText(attributes.unit);
    return unit && unit !== 'bool' ? `${text} ${unit}` : text;
  }
  return text;
}

/** A row's two lines: what happened, and what it happened to. */
export function describeEvent(event: ActivityEvent, t: TFunction): { title: string; detail: string | null } {
  const parts = SUBJECT_KEYS.filter((k) => event.attributes[k] !== undefined).map((k) =>
    subjectText(k, event.attributes, t),
  );
  return {
    title: t(eventTitleKey(event.action)),
    detail: parts.length > 0 ? parts.slice(0, 3).join(' · ') : null,
  };
}

/**
 * Several reads as one list, newest first and at most `limit` long. Parsed
 * rather than compared as text: the Pond's fractional seconds vary in length,
 * and `09:00:00.5Z` sorts before `09:00:00Z` as a string.
 */
export function newestFirst(events: ActivityEvent[], limit: number): ActivityEvent[] {
  return [...events]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit);
}

/**
 * React keys for one read, in its order. The Pond's events carry no id, and
 * two can share a timestamp and an action, so each twin is numbered among
 * its twins counting from the oldest end: a poll that brings newer events
 * adds rows above without renaming the ones a reader is looking at.
 */
export function eventKeys(events: ActivityEvent[]): string[] {
  const seen = new Map<string, number>();
  const keys: string[] = new Array(events.length);
  for (let i = events.length - 1; i >= 0; i--) {
    const twin = `${events[i].timestamp}|${events[i].action}`;
    const n = seen.get(twin) ?? 0;
    seen.set(twin, n + 1);
    keys[i] = `${twin}|${n}`;
  }
  return keys;
}

// ── Mock data ────────────────────────────────────────────────────────────────
//
// Shaped exactly as `GET /activity` sends it, so mock and real render through
// the same rows: the actions and attributes are the Pond's own emitters'.

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export const SAMPLE_ACTIVITY: ActivityEvent[] = [
  {
    category: 'tool',
    action: 'tool.call',
    timestamp: ago(4),
    privacy_sensitivity: 'internal',
    session_id: 'sample-session',
    attributes: { tool: { text: 'get_current_weather' } },
  },
  {
    category: 'network',
    action: 'egress.http',
    timestamp: ago(4),
    privacy_sensitivity: 'public',
    session_id: 'sample-session',
    attributes: {
      host: { text: 'api.open-meteo.com' },
      method: { text: 'GET' },
      latency_ms: { int: 212 },
      tool: { text: 'get_current_weather' },
      status: { int: 200 },
    },
  },
  {
    category: 'inference',
    action: 'inference.completion',
    timestamp: ago(5),
    privacy_sensitivity: 'internal',
    session_id: 'sample-session',
    attributes: {
      prompt_tokens: { int: 812 },
      completion_tokens: { int: 64 },
      model: { text: 'qwen3-4b' },
    },
  },
  {
    category: 'agent',
    action: 'agent.turn',
    timestamp: ago(5),
    privacy_sensitivity: 'internal',
    session_id: 'sample-session',
    attributes: { tool_count: { int: 1 } },
  },
  {
    category: 'device',
    action: 'device.state_changed',
    timestamp: ago(12),
    privacy_sensitivity: 'internal',
    attributes: { device_id: { text: 'kitchen-lamp' }, key: { text: 'power' } },
  },
  {
    category: 'sensor',
    action: 'sensor.reading',
    timestamp: ago(31),
    privacy_sensitivity: 'sensitive',
    attributes: {
      device_id: { text: 'hallway-thermostat' },
      sensor_type: { text: 'temperature' },
      value: { float: 21.5 },
      unit: { text: 'C' },
    },
  },
  {
    category: 'camera',
    action: 'camera.event',
    timestamp: ago(48),
    privacy_sensitivity: 'sensitive',
    attributes: { camera_id: { text: 'front-door' }, event_type: { text: 'motion' } },
  },
  {
    category: 'agent',
    action: 'session.lifecycle',
    timestamp: ago(65),
    privacy_sensitivity: 'sensitive',
    attributes: { phase: { text: 'idle' }, idle_secs: { int: 900 } },
  },
  {
    category: 'auth',
    action: 'auth.device_paired',
    timestamp: ago(60 * 26),
    privacy_sensitivity: 'sensitive',
    attributes: { device_name: { text: 'iPhone' } },
  },
];

// ── Problems: the Pond's operational log ─────────────────────────────────────
//
// `GET /logs` is a different store from activity: the Pond's own tracing
// output, kept at WARN and above (plus INFO from trace targets). It is what
// the Problems filter shows, so a household can see what went wrong without
// it crowding the everyday activity.

/** WARN and ERROR, case-blind: the INFO rows are trace chatter, not problems. */
export function isProblem(entry: LogEntry): boolean {
  const level = entry.level.toUpperCase();
  return level === 'WARN' || level === 'ERROR';
}

/**
 * A log row's timestamp as ISO 8601. The Pond writes these with SQLite's
 * `datetime('now')`, "YYYY-MM-DD HH:MM:SS", which is UTC but says so nowhere;
 * read as-is, `Date` would take it for local time and be hours out.
 */
export function parsePondLogTime(timestamp: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(timestamp.trim());
  return m ? `${m[1]}T${m[2]}Z` : timestamp;
}

const sqliteAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');

export const SAMPLE_PROBLEMS: LogEntry[] = [
  {
    id: 2,
    timestamp: sqliteAgo(12),
    level: 'WARN',
    source: 'pond_mcp::client',
    message: 'Calendar tool took 9.8s to answer; still waiting',
    metadata: null,
  },
  {
    id: 1,
    timestamp: sqliteAgo(60 * 20),
    level: 'ERROR',
    source: 'pond_matter::controller',
    message: 'Kitchen plug did not answer three times; marked unreachable',
    metadata: null,
  },
];
