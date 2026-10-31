/**
 * Schedules and rules, as the Schedule screen reads them (issue #14).
 *
 * The wire types are the Pond's and live in `services/types.ts`. What is here
 * is what the screen needs on top: telling the two kinds of task apart, the
 * cron a one-off becomes, and the sample data the screen shows while its
 * Developer toggle is on mock.
 *
 * Schedules and rules are kept apart on purpose. The Pond stores both in one
 * table, but a schedule fires on a clock and a rule fires on a reading: one has
 * a next run and a run-now, the other has a cooldown and neither. Shown in one
 * list they would each be missing half of what their card says, so the screen
 * has a tab for each.
 */

import type { CivilDate, CivilTime, InkTone } from '@jarida/ink';

import i18n from '@/services/i18n';
import type { TranslationKey } from '@/services/i18n';
import { decodeEntities, parseReply, type MarkedToken, type Token } from '@/services/markdown';
import type { CreateScheduleRequest, Rule, Schedule, TriggerAction, UpdateScheduleRequest } from '@/services/types';

/** A sensor rule, which `GET /schedules` returns alongside the timed schedules. */
export function isRule(schedule: Schedule): boolean {
  return schedule.kind.type === 'sensor_trigger';
}

/** The timed schedules only, soonest first; ones with no next run go last, by name. */
export function timedSchedules(schedules: Schedule[]): Schedule[] {
  return schedules
    .filter((s) => !isRule(s))
    .sort((a, b) => {
      if (a.next_run && b.next_run) return a.next_run.localeCompare(b.next_run);
      if (a.next_run) return -1;
      if (b.next_run) return 1;
      return a.label.localeCompare(b.label);
    });
}

/**
 * The Pond's cron has six fields, seconds first (`sec min hour day month
 * weekday`). A five-field expression, the usual Unix shape, is refused with
 * "invalid cron expression", so the form checks the count before sending.
 *
 * The seconds field must also be one literal second, 0 to 59. A `*`, step,
 * range or list there is valid cron that runs the agent several times a
 * minute; a step of 15 runs it every 15 seconds.
 */
export function isSixFieldCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  return fields.length === 6 && /^\d{1,2}$/.test(fields[0]) && Number(fields[0]) <= 59;
}

/**
 * The cron for a one-off at a date and time.
 *
 * `POST /schedules` takes no `fire_at`, so a one-off is a cron pinned to its
 * day, month and year, sent with `once: true`: the Pond runs it at the first
 * match and then removes it. The year is the optional seventh field the
 * Pond's croner reads; without it a date a year or more out would match a
 * year early.
 */
export function oneOffCron(date: CivilDate, time: CivilTime): string {
  return `0 ${time.minute} ${time.hour} ${date.day} ${date.month} * ${date.year}`;
}

/**
 * The phone's IANA time zone, which every schedule made here is created in.
 *
 * The Pond reads a schedule's cron as wall-clock time in its own zone, one-off
 * and repeating alike, so "every day at 08:00" made on this phone is 08:00
 * here. Repeating schedules used to be sent without one, because the Pond
 * then fired every repeat in UTC whatever zone it named; it has since resolved
 * each occurrence in the schedule's zone (`next_occurrence` in its
 * `cron_scheduler.rs`), and a repeat sent in UTC now runs hours away from the
 * time the person picked.
 *
 * `expo-localization` is native, so a JS-only run falls back to UTC rather
 * than throwing.
 */
export function deviceTimeZone(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const zone = require('expo-localization').getCalendars()[0]?.timeZone;
    return typeof zone === 'string' && zone ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * When a schedule runs or ran, in the words the card uses: "Today 7:00 AM",
 * "Tomorrow 9:30 AM", "Yesterday 6:00 PM", or a short date beyond that. Both
 * directions are needed — a next run is ahead, a last run behind.
 */
export function formatScheduleTime(iso: string, now = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const time = then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const dayOffset = Math.round((startOfDay(then) - startOfDay(now)) / 86_400_000);
  if (dayOffset === 0) return i18n.t('schedule.time.today', { time });
  if (dayOffset === 1) return i18n.t('schedule.time.tomorrow', { time });
  if (dayOffset === -1) return i18n.t('schedule.time.yesterday', { time });
  const date = then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return i18n.t('schedule.time.onDate', { date, time });
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// A run, as its row reads it.

/**
 * How long a run took, the way a person says it: "850 ms", "59 s", "2 min 9 s",
 * "1 h 5 min". The Pond sends milliseconds, and "128820 ms" is a number to be
 * worked out rather than read. Below a second the milliseconds are the only
 * figure there is; from a second up they are noise, so they round away.
 */
export function formatRunDuration(ms: number): string {
  const whole = Math.max(0, Math.round(ms));
  if (whole < 1000) return i18n.t('schedule.runs.durationMs', { ms: whole });
  const seconds = Math.round(whole / 1000);
  if (seconds < 60) return i18n.t('schedule.runs.durationSeconds', { s: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const s = seconds % 60;
    return s === 0
      ? i18n.t('schedule.runs.durationMinutes', { m: minutes })
      : i18n.t('schedule.runs.durationMinutesSeconds', { m: minutes, s });
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0
    ? i18n.t('schedule.runs.durationHours', { h })
    : i18n.t('schedule.runs.durationHoursMinutes', { h, m });
}

/** Lines a collapsed run shows: enough to tell one answer from the next. */
export const RUN_PREVIEW_LINES = 3;
/** Characters a collapsed run shows, so three long lines cannot wrap into six. */
export const RUN_PREVIEW_CHARS = 160;

/** The words of inline markdown, with its markers gone. */
function inlinePlain(tokens: Token[] | undefined): string {
  return (tokens ?? [])
    .map((token) => {
      const t = token as MarkedToken;
      if (t.type === 'br') return ' ';
      if ('tokens' in t && t.tokens) return inlinePlain(t.tokens);
      return 'text' in t ? decodeEntities(t.text) : '';
    })
    .join('');
}

/** One line per paragraph, heading, list item or code line, with no markdown left in any. */
function blockPlain(tokens: Token[]): string[] {
  return tokens.flatMap((token) => {
    const t = token as MarkedToken;
    switch (t.type) {
      case 'space':
      case 'hr':
        return [];
      case 'list':
        return t.items.flatMap((item) => blockPlain(item.tokens));
      case 'blockquote':
        return blockPlain(t.tokens);
      case 'code':
        return t.text.split('\n');
      case 'table':
        return [t.header, ...t.rows].map((row) => row.map((cell) => inlinePlain(cell.tokens)).join('  '));
      case 'html':
        return [t.text.replace(/<[^>]*>/g, '')];
      default:
        return 'tokens' in t && t.tokens ? [inlinePlain(t.tokens)] : 'text' in t ? [decodeEntities(t.text)] : [];
    }
  });
}

/**
 * A run's output cut to a few plain lines for its collapsed row. The agent
 * writes markdown, and a row is too small to draw it, so the markers are taken
 * out rather than shown: `**Weather in Nairobi:**` reads as the words alone.
 * `truncated` says whether anything was left out, which is what makes the row
 * worth opening; a short answer is already all there.
 */
export function runPreview(source: string): { text: string; truncated: boolean } {
  const lines = blockPlain(parseReply(source))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
  let text = lines.slice(0, RUN_PREVIEW_LINES).join('\n');
  let truncated = lines.length > RUN_PREVIEW_LINES;
  if (text.length > RUN_PREVIEW_CHARS) {
    text = text.slice(0, RUN_PREVIEW_CHARS).trimEnd();
    truncated = true;
  }
  return { text: truncated ? `${text}…` : text, truncated };
}

// ── Cron in words ────────────────────────────────────────────────────────────

/** A one-off: the Pond stores it with the `@once` cron and the instant in `fire_at`. */
export function isOneOff(schedule: Schedule): boolean {
  return schedule.fire_at != null || schedule.cron === '@once';
}

const NUMBER = /^\d{1,2}$/;
const ANY = new Set(['*', '?']);

function twoDigits(n: number): string {
  return String(n).padStart(2, '0');
}

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** A weekday as a number or a name; `SUN` ending a range is 7, so `SAT-SUN` reads as the weekend. */
function weekdayNumber(token: string, ending: boolean): number | null {
  if (/^\d$/.test(token)) return Number(token);
  const named = DAY_NAMES.indexOf(token.toUpperCase());
  if (named === -1) return null;
  return named === 0 && ending ? 7 : named;
}

/**
 * 0 for Sunday, or null for a shape this does not read (steps, `L`, `#`); `7` is Sunday too, as croner
 * reads it. Names are read because agents' schedules are written with them (`MON-FRI`).
 */
function weekdays(field: string): Set<number> | null {
  const days = new Set<number>();
  for (const part of field.split(',')) {
    const range = /^(\d|[A-Za-z]{3})(?:-(\d|[A-Za-z]{3}))?$/.exec(part);
    if (!range) return null;
    const from = weekdayNumber(range[1], false);
    const to = range[2] == null ? from : weekdayNumber(range[2], true);
    if (from === null || to === null || from > 7 || to > 7 || to < from) return null;
    for (let d = from; d <= to; d++) days.add(d % 7);
  }
  return days;
}

function dayName(day: number, weekday: 'long' | 'short' = 'long'): string {
  // 2023-01-01 was a Sunday, so day n of that week is weekday n, and day 7 is Sunday again.
  return new Date(2023, 0, 1 + day).toLocaleDateString(undefined, { weekday });
}

const same = (a: Set<number>, b: number[]) => a.size === b.length && b.every((d) => a.has(d));

/**
 * A cron expression in words: "Every Sunday at 18:30", "Weekdays at 07:00",
 * "Every 15 minutes". The Pond's cron has six fields, seconds first, and an
 * optional seventh for the year, which is how a one-off made here is pinned.
 *
 * Null for any shape this does not read, so the caller shows the cron itself
 * rather than words that might say something the Pond will not do. The time
 * is the schedule's own wall-clock time, in its own zone.
 */
export function describeCron(cron: string): string | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 6 && fields.length !== 7) return null;
  const [sec, min, hour, dom, month, dow, year] = fields;
  if (!NUMBER.test(sec)) return null;
  const pinnedYear = year != null && !ANY.has(year) ? year : null;
  if (pinnedYear != null && !/^\d{4}$/.test(pinnedYear)) return null;
  const anyDay = ANY.has(dom) && ANY.has(month) && ANY.has(dow);

  // Intervals within a day.
  if (anyDay && pinnedYear == null && ANY.has(hour)) {
    if (ANY.has(min)) return i18n.t('schedule.cron.everyMinutes', { count: 1 });
    const minuteStep = /^\*\/(\d{1,2})$/.exec(min);
    if (minuteStep) return i18n.t('schedule.cron.everyMinutes', { count: Number(minuteStep[1]) });
    if (NUMBER.test(min)) return i18n.t('schedule.cron.hourly', { minute: twoDigits(Number(min)) });
    return null;
  }
  const hourStep = /^\*\/(\d{1,2})$/.exec(hour);
  if (anyDay && pinnedYear == null && hourStep && NUMBER.test(min)) {
    return i18n.t('schedule.cron.everyHours', { count: Number(hourStep[1]), minute: twoDigits(Number(min)) });
  }

  // At one time of day.
  if (!NUMBER.test(min) || !NUMBER.test(hour)) return null;
  const time = `${twoDigits(Number(hour))}:${twoDigits(Number(min))}`;

  if (ANY.has(dom) && ANY.has(month) && pinnedYear == null) {
    if (ANY.has(dow)) return i18n.t('schedule.cron.everyDay', { time });
    const days = weekdays(dow);
    if (!days) return null;
    if (same(days, [1, 2, 3, 4, 5])) return i18n.t('schedule.cron.weekdays', { time });
    if (same(days, [0, 6])) return i18n.t('schedule.cron.weekends', { time });
    // Monday first, as a week reads.
    const names = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.has(d)).map((d) => dayName(d));
    return i18n.t('schedule.cron.onDays', { days: names.join(', '), time });
  }

  if (!NUMBER.test(dom) || !ANY.has(dow)) return null;
  if (ANY.has(month)) {
    return pinnedYear == null ? i18n.t('schedule.cron.monthly', { day: Number(dom), time }) : null;
  }
  if (!NUMBER.test(month)) return null;
  if (pinnedYear != null) {
    const date = new Date(Number(pinnedYear), Number(month) - 1, Number(dom)).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    return i18n.t('schedule.cron.onDate', { date, time });
  }
  const date = new Date(2000, Number(month) - 1, Number(dom)).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
  });
  return i18n.t('schedule.cron.yearly', { date, time });
}

/**
 * When a schedule runs, as its card and its detail say it: the cron in words,
 * or for a one-off the moment it fires. A zone other than the phone's is
 * named, since the words are that zone's wall-clock time. `words` is false
 * when nothing better than the raw cron could be said, which is then shown in
 * a monospaced face.
 */
export function describeWhen(schedule: Schedule, phoneZone: string): { text: string; words: boolean } {
  if (isOneOff(schedule)) {
    // A one-off's moment is an instant, shown in the phone's own time.
    const at = schedule.fire_at ? formatScheduleTime(schedule.fire_at) : '';
    return { text: i18n.t('schedule.cron.once', { when: at }), words: true };
  }
  const words = describeCron(schedule.cron);
  if (!words) return { text: schedule.cron, words: false };
  if (schedule.timezone === phoneZone) return { text: words, words: true };
  return { text: i18n.t('schedule.cron.inZone', { when: words, zone: schedule.timezone }), words: true };
}

// ── Opening one schedule ─────────────────────────────────────────────────────

/** A Pond id: a UUID, optionally prefixed. Nothing that could be a path. */
const POND_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The schedule a `schedule_id` search param names, or null. The param comes
 * from a notification tap, or any link that opens the Schedule screen, so it
 * is checked again here rather than trusted: a malformed one opens the list.
 */
export function linkedScheduleId(param: string | string[] | undefined): string | null {
  const raw = Array.isArray(param) ? param[0] : param;
  return typeof raw === 'string' && POND_ID.test(raw) ? raw : null;
}

// ── The schedule form ────────────────────────────────────────────────────────

/**
 * How a schedule runs, as the form offers it: the dashboard's six choices.
 * Each repeat but `custom` is a fixed cron shape filled from a few fields;
 * `custom` is the cron itself, typed by hand.
 */
export type Timing = 'once' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

/** The choices, in the order the form shows them. */
export const TIMINGS: readonly Timing[] = ['once', 'hourly', 'daily', 'weekly', 'monthly', 'custom'];

/**
 * The weekdays as the Pond's cron numbers them, Monday first: 1 is Monday and
 * 7 is Sunday, as the dashboard writes them. The Pond's croner reads 7 as
 * Sunday (and 0 too, which the form never writes).
 */
export const CRON_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

/** A weekday's short name in the phone's language, from its cron number (1 Monday to 7 Sunday). */
export function weekdayShortName(day: number): string {
  return dayName(day, 'short');
}

/** What a schedule does: ask Goose with a prompt, or set devices as a routine. */
export type Does = 'prompt' | 'routine';

/** What the create and edit form holds, as typed. */
export interface ScheduleDraft {
  name: string;
  does: Does;
  prompt: string;
  /** A routine's devices: on or off by device id. A device not listed is left as it is. */
  devices: Record<string, boolean>;
  timing: Timing;
  /** The day a one-off runs. */
  date: CivilDate | null;
  /** When a one-off runs, and the time of day a daily, weekly or monthly repeat runs at. */
  time: CivilTime | null;
  /** Hourly: every this many hours, 1 to 23. */
  everyHours: number;
  /** Hourly: at this many minutes past, 0 to 59. */
  minute: number;
  /** Weekly: the days it runs on, 1 Monday to 7 Sunday. */
  weekdays: number[];
  /** Monthly: the day of the month, 1 to 31. */
  dayOfMonth: number;
  /** Custom: the cron as typed. */
  cron: string;
  timezone: string;
  /** Ask before running a missed repeat, or skip it. Null on a Pond that cannot ask. */
  askIfMissed: boolean | null;
}

/** Whether this Pond can ask about missed runs: it says so on every schedule once it can. */
export function pondAsksIfMissed(schedules: Schedule[]): boolean {
  return schedules.some((s) => s.ask_if_missed !== undefined);
}

/** The request, or the key of the sentence that says what to fix. */
export type DraftResult<T> = { ok: true; req: T } | { ok: false; error: TranslationKey };

/** The prompt a schedule runs, or null for a webhook or a routine, which have none. */
export function promptOf(schedule: Schedule): string | null {
  return schedule.kind.type === 'agent_prompt' ? schedule.kind.prompt : null;
}

/** A routine's devices as the form holds them, or null when it is not a routine. */
export function routineDevices(schedule: Schedule): Record<string, boolean> | null {
  if (schedule.kind.type !== 'routine') return null;
  const devices: Record<string, boolean> = {};
  for (const a of schedule.kind.actions) if (a.type === 'device_power') devices[a.device_id] = a.on;
  return devices;
}

/** What a routine sets, in words: "Kitchen lights on, Water heater off". An unknown device shows its id. */
export function describeRoutine(devices: Record<string, boolean>, names: Record<string, string>): string {
  return Object.entries(devices)
    .map(([id, on]) => i18n.t(on ? 'schedule.detail.deviceOn' : 'schedule.detail.deviceOff', { name: names[id] ?? id }))
    .join(', ');
}

/**
 * A routine's actions from the form's devices. Anything it did besides switching devices is kept
 * as it was, after them, since the form has no way to show or change it.
 */
function routineActions(devices: Record<string, boolean>, original?: Schedule): TriggerAction[] {
  const kept = original?.kind.type === 'routine' ? original.kind.actions.filter((a) => a.type !== 'device_power') : [];
  const set = Object.entries(devices).map(([device_id, on]): TriggerAction => ({ type: 'device_power', device_id, on }));
  return [...set, ...kept];
}

/** What the repeat fields hold before anything is chosen; the dashboard's defaults. */
const REPEAT_DEFAULTS = { everyHours: 1, minute: 0, weekdays: [1], dayOfMonth: 1 };

/** An empty form for a new schedule, in the phone's zone. Asking about a missed run starts on, where it can. */
export function emptyDraft(timezone: string, asksIfMissed = false): ScheduleDraft {
  return {
    name: '',
    does: 'prompt',
    prompt: '',
    devices: {},
    timing: 'once',
    date: null,
    time: null,
    ...REPEAT_DEFAULTS,
    cron: '',
    timezone,
    askIfMissed: asksIfMissed ? true : null,
  };
}

const whole = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;

/**
 * Weekdays as the dashboard's `formatDays` writes them: in week order, with a
 * run of three or more days as a range and shorter runs as single days, so
 * Monday to Friday is `1-5`, Saturday and Sunday `6,7`, and `1,3,5` a list.
 */
function formatWeekdays(days: number[]): string {
  const sorted = CRON_WEEKDAYS.filter((day) => days.includes(day));
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i >= 2) parts.push(`${sorted[i]}-${sorted[j]}`);
    else parts.push(...sorted.slice(i, j + 1).map(String));
    i = j + 1;
  }
  return parts.join(',');
}

/**
 * The days a weekday field of single days and ranges names (`1-5`, `1,3,5`),
 * 1 Monday to 7 Sunday, or null for anything else. Whether it is written the
 * way the form would write it is `repeatFrom`'s round-trip check.
 */
function parseWeekdays(field: string): number[] | null {
  const days: number[] = [];
  for (const part of field.split(',')) {
    const range = /^([1-7])(?:-([1-7]))?$/.exec(part);
    if (!range) return null;
    const from = Number(range[1]);
    const to = range[2] == null ? from : Number(range[2]);
    if (to < from) return null;
    for (let day = from; day <= to; day++) days.push(day);
  }
  return days;
}

/**
 * The cron a repeat other than `custom` becomes, written exactly as the
 * dashboard's `buildCron` writes it (six fields, seconds first), so a schedule
 * made on either reads back the same on the other. Weekly days go in week
 * order, whatever order they were tapped in (see `formatWeekdays`).
 */
export function presetCron(d: ScheduleDraft): DraftResult<string> {
  if (d.timing === 'hourly') {
    if (!whole(d.everyHours, 1, 23) || !whole(d.minute, 0, 59)) {
      return { ok: false, error: 'schedule.errors.repeatNumbers' };
    }
    return { ok: true, req: `0 ${d.minute} */${d.everyHours} * * *` };
  }
  if (!d.time) return { ok: false, error: 'schedule.errors.timeRequired' };
  const { hour, minute } = d.time;
  switch (d.timing) {
    case 'daily':
      return { ok: true, req: `0 ${minute} ${hour} * * *` };
    case 'weekly': {
      const days = formatWeekdays(d.weekdays);
      if (!days) return { ok: false, error: 'schedule.errors.daysRequired' };
      return { ok: true, req: `0 ${minute} ${hour} * * ${days}` };
    }
    case 'monthly':
      if (!whole(d.dayOfMonth, 1, 31)) return { ok: false, error: 'schedule.errors.repeatNumbers' };
      return { ok: true, req: `0 ${minute} ${hour} ${d.dayOfMonth} * *` };
    default:
      return { ok: false, error: 'schedule.errors.cronFields' };
  }
}

/** The repeat fields of a draft: everything but its name, prompt and zone. */
type RepeatFields = Omit<ScheduleDraft, 'name' | 'prompt' | 'timezone' | 'does' | 'devices' | 'askIfMissed'>;

/**
 * The choice a repeating cron opens on: the preset whose builder writes this
 * very cron back, or `custom` with the cron as it is. Reading it any looser
 * would lose something on save — `1,2,3,4,5` is not how the weekly picker
 * writes Monday to Friday (`1-5`), and a `07` minute is not the `7` it would
 * send — so anything that does not round-trip stays the raw cron, untouched.
 */
export function repeatFrom(cron: string): RepeatFields {
  const custom: RepeatFields = {
    timing: 'custom',
    date: null,
    time: null,
    ...REPEAT_DEFAULTS,
    cron,
  };
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 6) return custom;
  const [, min, hour, dom, , dow] = fields;
  const num = (field: string) => (NUMBER.test(field) ? Number(field) : NaN);

  const hourStep = /^\*\/(\d{1,2})$/.exec(hour);
  const candidates: RepeatFields[] = [];
  if (hourStep) {
    candidates.push({ ...custom, timing: 'hourly', everyHours: Number(hourStep[1]), minute: num(min) });
  } else {
    const time = { hour: num(hour), minute: num(min) };
    candidates.push(
      { ...custom, timing: 'daily', time },
      { ...custom, timing: 'weekly', time, weekdays: parseWeekdays(dow) ?? [] },
      { ...custom, timing: 'monthly', time, dayOfMonth: num(dom) },
    );
  }
  for (const candidate of candidates) {
    if (candidate.time && !(whole(candidate.time.hour, 0, 23) && whole(candidate.time.minute, 0, 59))) continue;
    const built = presetCron({ ...candidate, name: '', prompt: '', timezone: '', does: 'prompt', devices: {}, askIfMissed: null });
    if (built.ok && built.req === fields.join(' ')) return { ...candidate, cron };
  }
  return custom;
}

/**
 * The form filled with a schedule as the Pond has it. A one-off's instant is
 * read back as a date and a time on this phone, which is how it was picked; a
 * repeat opens on its preset, or as custom (see `repeatFrom`).
 */
export function draftFrom(schedule: Schedule): ScheduleDraft {
  const devices = routineDevices(schedule);
  const base = {
    name: schedule.label,
    does: devices ? ('routine' as const) : ('prompt' as const),
    prompt: promptOf(schedule) ?? '',
    devices: devices ?? {},
    timezone: schedule.timezone,
    askIfMissed: schedule.ask_if_missed ?? null,
  };
  if (isOneOff(schedule) && schedule.fire_at) {
    const at = new Date(schedule.fire_at);
    return {
      ...base,
      timing: 'once',
      date: { year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate() },
      time: { hour: at.getHours(), minute: at.getMinutes() },
      ...REPEAT_DEFAULTS,
      cron: '',
    };
  }
  return { ...base, ...repeatFrom(schedule.cron) };
}

/** The checks the Pond would answer with a 400, and the one-off's instant. */
function checkTiming(d: ScheduleDraft, now: Date): DraftResult<{ at: Date | null; cron: string }> {
  if (d.timing === 'once') {
    if (!d.date || !d.time) return { ok: false, error: 'schedule.errors.whenRequired' };
    const at = new Date(d.date.year, d.date.month - 1, d.date.day, d.time.hour, d.time.minute);
    if (at.getTime() <= now.getTime()) return { ok: false, error: 'schedule.errors.whenPast' };
    return { ok: true, req: { at, cron: oneOffCron(d.date, d.time) } };
  }
  if (d.timing === 'custom') {
    if (!isSixFieldCron(d.cron)) return { ok: false, error: 'schedule.errors.cronFields' };
    return { ok: true, req: { at: null, cron: d.cron.trim() } };
  }
  const built = presetCron(d);
  return built.ok ? { ok: true, req: { at: null, cron: built.req } } : built;
}

/**
 * The cron the draft would be sent as, for the form's preview, or null while
 * it is not yet complete or not valid. A one-off previews as its pinned cron,
 * which reads as its date.
 */
export function draftCron(d: ScheduleDraft): string | null {
  // A one-off in the past is still a date to read back; only `createRequest` refuses it.
  const timing = checkTiming(d, new Date(0));
  return timing.ok ? timing.req.cron : null;
}

/**
 * `POST /schedules` for a new schedule. A one-off is a pinned cron sent with
 * `once: true` (see `oneOffCron`); every kind carries the draft's zone.
 */
export function createRequest(d: ScheduleDraft, now = new Date()): DraftResult<CreateScheduleRequest> {
  if (!d.name.trim()) return { ok: false, error: 'schedule.errors.nameRequired' };
  const routine = d.does === 'routine';
  if (!routine && !d.prompt.trim()) return { ok: false, error: 'schedule.errors.promptRequired' };
  if (routine && Object.keys(d.devices).length === 0) return { ok: false, error: 'schedule.errors.devicesRequired' };
  const timing = checkTiming(d, now);
  if (!timing.ok) return timing;
  const req: CreateScheduleRequest = {
    name: d.name.trim(),
    cron: timing.req.cron,
    ...(routine ? { kind: { type: 'routine', actions: routineActions(d.devices) } } : { prompt: d.prompt.trim() }),
    timezone: d.timezone,
    once: d.timing === 'once',
  };
  // Only a repeat can be missed: a one-off the Pond slept through still fires late.
  if (d.timing !== 'once' && d.askIfMissed !== null) req.ask_if_missed = d.askIfMissed;
  return { ok: true, req };
}

/**
 * Whether the draft runs at a different time from the schedule. A repeat is
 * compared by the cron it would send, so opening a weekly schedule, looking
 * at it as custom and saving changes nothing; a custom cron left as it was is
 * not re-checked, so a shape the form would refuse does not block an edit to
 * the name.
 */
function timingChanged(original: Schedule, d: ScheduleDraft): boolean {
  const was = draftFrom(original);
  if (d.timing === 'once' || was.timing === 'once') {
    return d.timing !== was.timing || JSON.stringify([d.date, d.time]) !== JSON.stringify([was.date, was.time]);
  }
  if (d.timing === 'custom') return d.cron.trim() !== original.cron.trim();
  const built = presetCron(d);
  return !built.ok || built.req !== original.cron.trim();
}

/**
 * `PUT /schedules/{id}` for an edit, carrying only what changed: the Pond
 * leaves an absent field as it is, and a changed shape re-registers the job,
 * so an edit to the name alone should not touch when it runs.
 *
 * A one-off's new moment goes as `fire_at`, an instant, which keeps it a
 * one-off; a cron alone would make it repeat. A cron sent for a one-off turns
 * it into a repeating schedule, which is what choosing a repeat means.
 *
 * A webhook's URL is not here: `PUT /schedules/{id}` takes a prompt, which
 * would replace the webhook with an agent prompt, and nothing else changes the
 * kind. Its prompt field is therefore ignored.
 */
export function updateRequest(
  original: Schedule,
  d: ScheduleDraft,
  now = new Date(),
): DraftResult<UpdateScheduleRequest> {
  const prompt = promptOf(original);
  const devices = routineDevices(original);
  if (!d.name.trim()) return { ok: false, error: 'schedule.errors.nameRequired' };
  if (prompt != null && !d.prompt.trim()) return { ok: false, error: 'schedule.errors.promptRequired' };
  if (devices && Object.keys(d.devices).length === 0) return { ok: false, error: 'schedule.errors.devicesRequired' };

  const req: UpdateScheduleRequest = {};
  if (d.name.trim() !== original.label) req.name = d.name.trim();
  if (prompt != null && d.prompt.trim() !== prompt) req.prompt = d.prompt.trim();
  if (devices && !sameDevices(d.devices, devices)) {
    req.kind = { type: 'routine', actions: routineActions(d.devices, original) };
  }
  if (d.timezone !== original.timezone) req.timezone = d.timezone;

  if (timingChanged(original, d)) {
    const timing = checkTiming(d, now);
    if (!timing.ok) return timing;
    if (timing.req.at) req.fire_at = timing.req.at.toISOString();
    else req.cron = timing.req.cron;
  }
  if (d.timing !== 'once' && d.askIfMissed !== null && d.askIfMissed !== (original.ask_if_missed ?? null)) {
    req.ask_if_missed = d.askIfMissed;
  }
  return { ok: true, req };
}

function sameDevices(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const ids = Object.keys(a);
  return ids.length === Object.keys(b).length && ids.every((id) => b[id] === a[id]);
}

// ── Mock data ────────────────────────────────────────────────────────────────
//
// What the screen shows with its Developer toggle on mock. Shaped exactly as
// the Pond sends them, so the mock and real paths render through the same
// cards and nothing has to be translated between the two.

const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();

export const SAMPLE_SCHEDULES: Schedule[] = [
  {
    id: 'sample-morning',
    label: 'Morning briefing',
    cron: '0 0 7 * * 1-5',
    fire_at: null,
    timezone: 'Africa/Nairobi',
    kind: { type: 'agent_prompt', prompt: 'Summarise my calendar, the weather and anything urgent.' },
    paused: false,
    currently_running: false,
    last_run: at(-17),
    next_run: at(7),
    created_at: at(-24 * 14),
  },
  {
    id: 'sample-plants',
    label: 'Water the plants',
    cron: '0 30 18 * * 0',
    fire_at: null,
    timezone: 'Africa/Nairobi',
    kind: { type: 'agent_prompt', prompt: 'Remind me to water the plants.' },
    paused: true,
    currently_running: false,
    last_run: null,
    next_run: null,
    created_at: at(-24 * 3),
  },
];

export const SAMPLE_RULES: Rule[] = [
  {
    id: 'sample-heat',
    name: 'Too warm in the living room',
    paused: false,
    currently_running: false,
    created_at: at(-24 * 5),
    last_fired: at(-30),
    cooldown_secs: 600,
    source: { kind: 'sensor', signal: 'temperature' },
    condition: { op: 'gt', value: 28 },
    actions: [{ type: 'notify', title: 'It is getting warm', body: 'The living room is above 28°.' }],
  },
];
