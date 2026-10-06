/**
 * The Activity screen's reading of the Pond's activity log (issue #15).
 *
 * The wire type is `ActivityEvent` (`services/types.ts`): a category, a dotted
 * action such as `device.set_power`, and tagged attributes. What is here turns
 * that into rows a household reads — which filter an event belongs to, its
 * icon, a line of text — plus the sample events the screen shows while its
 * Developer toggle is on mock.
 */

import type { IconName } from '@/constants/icons';
import type { TranslationKey } from '@/services/i18n';
import type { ActivityEvent, AttributeValue, EventCategory, LogEntry } from '@/services/types';

/**
 * The filters, named for what a reader is looking for rather than for the
 * nine categories behind them: nobody looks for "inference", they look for
 * what Goose did.
 */
export type ActivityFilter = 'all' | 'action' | 'mcp' | 'home' | 'system';

export const ACTIVITY_FILTERS: ActivityFilter[] = ['all', 'action', 'mcp', 'home', 'system'];

/** Which filter a category falls under. Exhaustive, so a new category fails here until placed. */
export function filterOf(category: EventCategory): Exclude<ActivityFilter, 'all'> {
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
 * Attributes that say which thing an event was about, in the order worth
 * showing. `redacted` is the redactor's count of what it removed, which is
 * about the log rather than about the event.
 */
const SUBJECT_KEYS = ['name', 'device_name', 'tool', 'tool_name', 'device_id', 'model', 'signal', 'value'];

/**
 * A row's two lines: what happened, from the action's last segment
 * (`device.set_power` reads "set power"), and what it happened to.
 */
export function describeEvent(event: ActivityEvent): { title: string; detail: string | null } {
  const verb = event.action.split('.').pop() ?? event.action;
  const title = verb.replace(/_/g, ' ');
  const parts = SUBJECT_KEYS.filter((k) => event.attributes[k] !== undefined).map((k) =>
    attributeText(event.attributes[k]),
  );
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    detail: parts.length > 0 ? parts.slice(0, 3).join(' · ') : null,
  };
}

/**
 * A React key. The Pond's events carry no id, and two can share a timestamp,
 * so the position breaks the tie; the list is newest first and only ever
 * replaced whole, so a position names the same event within one read.
 */
export function eventKey(event: ActivityEvent, index: number): string {
  return `${event.timestamp}|${event.action}|${index}`;
}

// ── Mock data ────────────────────────────────────────────────────────────────
//
// Shaped exactly as `GET /activity` sends it, so mock and real render through
// the same rows.

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export const SAMPLE_ACTIVITY: ActivityEvent[] = [
  {
    category: 'device',
    action: 'device.set_power',
    timestamp: ago(4),
    privacy_sensitivity: 'internal',
    attributes: { device_name: { text: 'Living room lamp' }, on: { bool: true } },
  },
  {
    category: 'tool',
    action: 'tool.call',
    timestamp: ago(5),
    privacy_sensitivity: 'internal',
    attributes: { tool: { text: 'calendar' } },
  },
  {
    category: 'sensor',
    action: 'sensor.reading',
    timestamp: ago(31),
    privacy_sensitivity: 'public',
    attributes: { signal: { text: 'temperature' }, value: { float: 21.5 } },
  },
  {
    category: 'agent',
    action: 'agent.turn_completed',
    timestamp: ago(48),
    privacy_sensitivity: 'internal',
    attributes: { model: { text: 'qwen3-4b' } },
  },
  {
    category: 'auth',
    action: 'auth.pair',
    timestamp: ago(60 * 26),
    privacy_sensitivity: 'sensitive',
    attributes: { name: { text: 'iPhone' } },
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
