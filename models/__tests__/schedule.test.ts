/**
 * The Schedule screen's own rules on top of the Pond's types: which tasks are
 * rules, the order schedules show in, the cron a one-off becomes, how a run
 * time and a cron read, which id a link may open, and what the form sends.
 */

import {
  createRequest,
  describeRoutine,
  describeCron,
  draftCron,
  describeWhen,
  draftFrom,
  emptyDraft,
  formatScheduleTime,
  isRule,
  isSixFieldCron,
  linkedScheduleId,
  oneOffCron,
  repeatFrom,
  pondAsksIfMissed,
  timedSchedules,
  updateRequest,
  type ScheduleDraft,
} from '@/models/schedule';
import type { Schedule, ScheduleRun } from '@/services/types';

function schedule(overrides: Partial<Schedule>): Schedule {
  return {
    id: 'id',
    label: 'Label',
    cron: '0 0 7 * * *',
    fire_at: null,
    timezone: 'UTC',
    kind: { type: 'agent_prompt', prompt: 'p' },
    paused: false,
    currently_running: false,
    last_run: null,
    next_run: null,
    created_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

const RULE_KIND: Schedule['kind'] = {
  type: 'sensor_trigger',
  source: { kind: 'sensor' },
  actions: [{ type: 'notify', title: 't', body: 'b' }],
};

describe('timedSchedules', () => {
  /** `GET /schedules` returns rules too, stored as `@event`; they have their own tab. */
  it('leaves the rules out', () => {
    const rule = schedule({ id: 'rule', cron: '@event', kind: RULE_KIND });
    const timed = schedule({ id: 'timed' });

    expect(isRule(rule)).toBe(true);
    expect(timedSchedules([rule, timed]).map((s) => s.id)).toEqual(['timed']);
  });

  it('puts the soonest first, and ones with no next run last by name', () => {
    const list = [
      schedule({ id: 'paused-b', label: 'B' }),
      schedule({ id: 'later', next_run: '2026-10-06T09:00:00Z' }),
      schedule({ id: 'paused-a', label: 'A' }),
      schedule({ id: 'sooner', next_run: '2026-10-06T07:00:00Z' }),
    ];

    expect(timedSchedules(list).map((s) => s.id)).toEqual(['sooner', 'later', 'paused-a', 'paused-b']);
  });

  it('does not reorder the list it was given', () => {
    const list = [schedule({ id: 'b', label: 'B' }), schedule({ id: 'a', label: 'A' })];
    timedSchedules(list);
    expect(list.map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('cron', () => {
  /** The Pond's parser is seconds-first; the usual five-field form is refused. */
  it('accepts six fields and refuses five', () => {
    expect(isSixFieldCron('0 0 9 * * 1-5')).toBe(true);
    expect(isSixFieldCron('  0 0 9 * *   1-5 ')).toBe(true);
    expect(isSixFieldCron('0 9 * * 1-5')).toBe(false);
  });

  /** Anything but one literal second runs the agent several times a minute. */
  it('takes a single second, 0 to 59, in the seconds field', () => {
    expect(isSixFieldCron('30 0 9 * * *')).toBe(true);
    expect(isSixFieldCron('59 0 9 * * *')).toBe(true);
    expect(isSixFieldCron('*/15 * * * * *')).toBe(false);
    expect(isSixFieldCron('* 0 9 * * *')).toBe(false);
    expect(isSixFieldCron('0-30 0 9 * * *')).toBe(false);
    expect(isSixFieldCron('0,30 0 9 * * *')).toBe(false);
    expect(isSixFieldCron('60 0 9 * * *')).toBe(false);
  });

  /** Without the year, a date a year or more out would match a year early. */
  it('pins a one-off to its second, minute, hour, day, month and year', () => {
    expect(oneOffCron({ year: 2027, month: 12, day: 24 }, { hour: 18, minute: 5 })).toBe('0 5 18 24 12 * 2027');
  });
});

describe('formatScheduleTime', () => {
  const now = new Date(2026, 9, 5, 12, 0);

  it.each([
    ['today', new Date(2026, 9, 5, 18, 30), /^Today /],
    ['tomorrow', new Date(2026, 9, 6, 7, 0), /^Tomorrow /],
    ['yesterday', new Date(2026, 9, 4, 23, 59), /^Yesterday /],
  ])('says %s by name', (_, when, expected) => {
    expect(formatScheduleTime(when.toISOString(), now)).toMatch(expected);
  });

  it('gives a date further out', () => {
    expect(formatScheduleTime(new Date(2026, 9, 20, 9, 0).toISOString(), now)).not.toMatch(
      /^(Today|Tomorrow|Yesterday) /,
    );
  });

  it('says nothing for a timestamp it cannot read', () => {
    expect(formatScheduleTime('soon', now)).toBe('');
  });
});

describe('describeCron', () => {
  /** The mock's card showed "0 30 18 * * 0"; this is what it says now. */
  it('reads a weekly cron', () => {
    expect(describeCron('0 30 18 * * 0')).toBe('Every Sunday at 18:30');
    expect(describeCron('0 30 18 * * 7')).toBe('Every Sunday at 18:30');
    expect(describeCron('0 0 9 * * 1,3')).toBe('Every Monday, Wednesday at 09:00');
  });

  /** Agents' schedules are written with day names, as pond-desktop writes them. */
  it('reads days written as names', () => {
    expect(describeCron('0 0 7 * * MON-FRI')).toBe('Weekdays at 07:00');
    expect(describeCron('0 0 10 * * SAT,SUN')).toBe('Weekends at 10:00');
    expect(describeCron('0 0 10 * * SAT-SUN')).toBe('Weekends at 10:00');
    expect(describeCron('0 0 9 * * MON')).toBe('Every Monday at 09:00');
    expect(describeCron('0 30 18 * * mon,WED')).toBe('Every Monday, Wednesday at 18:30');
    expect(describeCron('0 0 7 * * FRI-MON')).toBeNull();
    expect(describeCron('0 0 7 * * MONDAY')).toBeNull();
  });

  it('reads daily, weekday and weekend crons', () => {
    expect(describeCron('0 0 7 * * *')).toBe('Every day at 07:00');
    expect(describeCron('0 0 7 * * 1-5')).toBe('Weekdays at 07:00');
    expect(describeCron('0 0 10 * * 0,6')).toBe('Weekends at 10:00');
  });

  it('reads a monthly, a yearly and a pinned one-off cron', () => {
    expect(describeCron('0 15 8 1 * *')).toBe('Monthly on day 1 at 08:15');
    expect(describeCron('0 0 9 24 12 *')).toBe('Every year on December 24 at 09:00');
    // The shape `oneOffCron` makes, with the year as a seventh field.
    expect(describeCron('0 5 18 24 12 * 2027')).toBe('On December 24, 2027 at 18:05');
  });

  it('reads intervals within a day', () => {
    expect(describeCron('0 * * * * *')).toBe('Every minute');
    expect(describeCron('0 */15 * * * *')).toBe('Every 15 minutes');
    expect(describeCron('0 5 * * * *')).toBe('Every hour at 05 minutes past');
    expect(describeCron('0 0 */2 * * *')).toBe('Every 2 hours at 00 minutes past');
  });

  /** Words that might promise something the Pond will not do are worse than the cron itself. */
  it('says nothing for a shape it does not read', () => {
    expect(describeCron('0 9 * * 1-5')).toBeNull(); // five fields
    expect(describeCron('*/10 * * * * *')).toBeNull(); // seconds step
    expect(describeCron('0 0 9-17 * * *')).toBeNull(); // hour range
    expect(describeCron('0 0 9 1 * 1')).toBeNull(); // day of month and weekday together
    expect(describeCron('@once')).toBeNull();
    expect(describeCron('@event')).toBeNull();
  });
});

describe('describeWhen', () => {
  it('reads a repeat in its own zone, and names the zone when it is not the phone\'s', () => {
    const s = schedule({ cron: '0 30 18 * * 0', timezone: 'Africa/Nairobi' });
    expect(describeWhen(s, 'Africa/Nairobi')).toEqual({ text: 'Every Sunday at 18:30', words: true });
    expect(describeWhen(s, 'Europe/London')).toEqual({
      text: 'Every Sunday at 18:30 (Africa/Nairobi)',
      words: true,
    });
  });

  it('falls back to the cron itself, marked as not words', () => {
    expect(describeWhen(schedule({ cron: '0 0 9-17 * * *' }), 'UTC')).toEqual({ text: '0 0 9-17 * * *', words: false });
  });

  it('reads a one-off as the moment it fires', () => {
    const at = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const s = schedule({ cron: '@once', fire_at: at });
    expect(describeWhen(s, 'UTC').text).toBe(`Once, ${formatScheduleTime(at)}`);
  });
});

describe('linkedScheduleId', () => {
  it('takes a Pond id', () => {
    expect(linkedScheduleId('sched-1')).toBe('sched-1');
    expect(linkedScheduleId(['3f2a_b', 'other'])).toBe('3f2a_b');
  });

  /** The param can arrive from any link; a path or a query in it opens the list, not a screen. */
  it('refuses anything that is not one', () => {
    expect(linkedScheduleId(undefined)).toBeNull();
    expect(linkedScheduleId('')).toBeNull();
    expect(linkedScheduleId('../developer')).toBeNull();
    expect(linkedScheduleId('a?b=c')).toBeNull();
    expect(linkedScheduleId('x'.repeat(129))).toBeNull();
  });
});

describe('the schedule form', () => {
  const now = new Date(2026, 9, 19, 12, 0);
  const draft = (overrides: Partial<ScheduleDraft>): ScheduleDraft => ({
    ...emptyDraft('Africa/Nairobi'),
    name: 'Daily Brief',
    prompt: 'Brief me',
    ...overrides,
  });

  /**
   * A repeat used to go without a zone, and the Pond now reads its cron in the
   * zone it names, so "07:00" would have run at 07:00 UTC.
   */
  it('creates a repeat in the phone\'s zone', () => {
    expect(createRequest(draft({ timing: 'custom', cron: ' 0 0 7 * * * ' }), now)).toEqual({
      ok: true,
      req: { name: 'Daily Brief', cron: '0 0 7 * * *', prompt: 'Brief me', timezone: 'Africa/Nairobi', once: false },
    });
  });

  it('creates a one-off as a pinned cron sent with once', () => {
    const built = createRequest(
      draft({ timing: 'once', date: { year: 2026, month: 10, day: 24 }, time: { hour: 18, minute: 5 } }),
      now,
    );
    expect(built).toEqual({
      ok: true,
      req: { name: 'Daily Brief', cron: '0 5 18 24 10 * 2026', prompt: 'Brief me', timezone: 'Africa/Nairobi', once: true },
    });
  });

  it('says what is missing before anything is sent', () => {
    expect(createRequest(draft({ name: ' ' }), now)).toEqual({ ok: false, error: 'schedule.errors.nameRequired' });
    expect(createRequest(draft({ prompt: '' }), now)).toEqual({ ok: false, error: 'schedule.errors.promptRequired' });
    expect(createRequest(draft({ timing: 'custom', cron: '0 9 * * *' }), now)).toEqual({
      ok: false,
      error: 'schedule.errors.cronFields',
    });
    const past = draft({ date: { year: 2026, month: 10, day: 19 }, time: { hour: 11, minute: 0 } });
    expect(createRequest(past, now)).toEqual({ ok: false, error: 'schedule.errors.whenPast' });
  });

  const brief = schedule({
    id: 'daily-brief',
    label: 'Daily Brief',
    cron: '0 0 7 * * *',
    timezone: 'Africa/Nairobi',
    kind: { type: 'agent_prompt', prompt: 'Brief me' },
  });

  it('opens an edit on the schedule as the Pond has it', () => {
    expect(draftFrom(brief)).toEqual({
      name: 'Daily Brief',
      does: 'prompt',
      prompt: 'Brief me',
      devices: {},
      timing: 'daily',
      date: null,
      time: { hour: 7, minute: 0 },
      everyHours: 1,
      minute: 0,
      weekdays: [1],
      dayOfMonth: 1,
      cron: '0 0 7 * * *',
      timezone: 'Africa/Nairobi',
      askIfMissed: null,
    });
    const at = new Date(2026, 9, 24, 18, 5);
    const oneOff = schedule({ cron: '@once', fire_at: at.toISOString() });
    expect(draftFrom(oneOff)).toMatchObject({
      timing: 'once',
      date: { year: 2026, month: 10, day: 24 },
      time: { hour: 18, minute: 5 },
    });
  });

  /** An edit to the name alone must not re-register when the schedule runs. */
  it('sends only what changed', () => {
    expect(updateRequest(brief, draftFrom(brief), now)).toEqual({ ok: true, req: {} });
    expect(updateRequest(brief, { ...draftFrom(brief), name: 'Morning Brief ' }, now)).toEqual({
      ok: true,
      req: { name: 'Morning Brief' },
    });
    expect(
      updateRequest(brief, { ...draftFrom(brief), prompt: 'Brief me, briefly', time: { hour: 6, minute: 30 } }, now),
    ).toEqual({ ok: true, req: { prompt: 'Brief me, briefly', cron: '0 30 6 * * *' } });
    expect(updateRequest(brief, { ...draftFrom(brief), timing: 'custom', cron: '0 30 6 * * *' }, now)).toEqual({
      ok: true,
      req: { cron: '0 30 6 * * *' },
    });
    expect(updateRequest(brief, { ...draftFrom(brief), timezone: 'UTC' }, now)).toEqual({
      ok: true,
      req: { timezone: 'UTC' },
    });
  });

  /** A cron alone would turn a one-off into a repeat; an instant keeps it a one-off. */
  it('moves a one-off with fire_at', () => {
    const oneOff = schedule({ cron: '@once', fire_at: new Date(2026, 9, 24, 18, 5).toISOString() });
    const moved = { ...draftFrom(oneOff), time: { hour: 19, minute: 0 } };
    expect(updateRequest(oneOff, moved, now)).toEqual({
      ok: true,
      req: { fire_at: new Date(2026, 9, 24, 19, 0).toISOString() },
    });
  });

  it('turns a one-off into a repeat with a cron', () => {
    const oneOff = schedule({ cron: '@once', fire_at: new Date(2026, 9, 24, 18, 5).toISOString() });
    const repeat = { ...draftFrom(oneOff), timing: 'custom' as const, cron: '0 0 7 * * *' };
    expect(updateRequest(oneOff, repeat, now)).toEqual({ ok: true, req: { cron: '0 0 7 * * *' } });
  });

  /** `PUT /schedules/{id}` with a prompt would replace the webhook with an agent prompt. */
  it('never sends a prompt for a webhook', () => {
    const hook = schedule({ kind: { type: 'webhook', webhook_url: 'https://example.com/h' } });
    expect(updateRequest(hook, { ...draftFrom(hook), prompt: 'anything' }, now)).toEqual({ ok: true, req: {} });
  });

  it('checks an edit as it checks a new one', () => {
    expect(updateRequest(brief, { ...draftFrom(brief), prompt: ' ' }, now)).toEqual({
      ok: false,
      error: 'schedule.errors.promptRequired',
    });
    expect(updateRequest(brief, { ...draftFrom(brief), timing: 'custom', cron: '* 0 7 * * *' }, now)).toEqual({
      ok: false,
      error: 'schedule.errors.cronFields',
    });
  });
});

describe('the repeat presets', () => {
  const now = new Date(2026, 9, 19, 12, 0);
  const at = (hour: number, minute: number) => ({ hour, minute });
  const draft = (overrides: Partial<ScheduleDraft>): ScheduleDraft => ({
    ...emptyDraft('Africa/Nairobi'),
    name: 'Daily Brief',
    prompt: 'Brief me',
    ...overrides,
  });
  const cronOf = (overrides: Partial<ScheduleDraft>) => {
    const built = createRequest(draft(overrides), now);
    return built.ok ? built.req.cron : built.error;
  };

  /** The dashboard's `buildCron`, field for field: a schedule made on either reads the same on the other. */
  it('builds the cron the dashboard builds', () => {
    expect(cronOf({ timing: 'hourly', everyHours: 1, minute: 0 })).toBe('0 0 */1 * * *');
    expect(cronOf({ timing: 'hourly', everyHours: 3, minute: 15 })).toBe('0 15 */3 * * *');
    expect(cronOf({ timing: 'daily', time: at(7, 5) })).toBe('0 5 7 * * *');
    expect(cronOf({ timing: 'weekly', weekdays: [1, 3, 5], time: at(18, 30) })).toBe('0 30 18 * * 1,3,5');
    expect(cronOf({ timing: 'monthly', dayOfMonth: 15, time: at(9, 0) })).toBe('0 0 9 15 * *');
    expect(cronOf({ timing: 'custom', cron: '0 0 9 * * 1-5' })).toBe('0 0 9 * * 1-5');
  });

  it('writes Sunday as 7 and the days in week order, whatever order they were tapped', () => {
    expect(cronOf({ timing: 'weekly', weekdays: [7, 1], time: at(8, 0) })).toBe('0 0 8 * * 1,7');
  });

  /** The dashboard's `formatDays`: three or more days in a row are a range, two are not. */
  it('writes a run of three or more days as a range, as the dashboard does', () => {
    expect(cronOf({ timing: 'weekly', weekdays: [5, 4, 3, 2, 1], time: at(7, 0) })).toBe('0 0 7 * * 1-5');
    expect(cronOf({ timing: 'weekly', weekdays: [6, 7], time: at(7, 0) })).toBe('0 0 7 * * 6,7');
    expect(cronOf({ timing: 'weekly', weekdays: [1, 2, 3, 5, 6, 7], time: at(7, 0) })).toBe('0 0 7 * * 1-3,5-7');
    expect(cronOf({ timing: 'weekly', weekdays: [1, 3, 5], time: at(7, 0) })).toBe('0 0 7 * * 1,3,5');
  });

  it('sends a repeat without once, and a one-off with it', () => {
    const repeat = createRequest(draft({ timing: 'weekly', weekdays: [6, 7], time: at(10, 0) }), now);
    expect(repeat.ok && repeat.req.once).toBe(false);
    const once = createRequest(draft({ timing: 'once', date: { year: 2026, month: 10, day: 24 }, time: at(9, 0) }), now);
    expect(once.ok && once.req).toMatchObject({ cron: '0 0 9 24 10 * 2026', once: true });
  });

  it('says what a preset is missing', () => {
    expect(cronOf({ timing: 'daily', time: null })).toBe('schedule.errors.timeRequired');
    expect(cronOf({ timing: 'weekly', weekdays: [], time: at(8, 0) })).toBe('schedule.errors.daysRequired');
    expect(cronOf({ timing: 'hourly', everyHours: 0 })).toBe('schedule.errors.repeatNumbers');
    expect(cronOf({ timing: 'hourly', everyHours: 2, minute: 1.5 })).toBe('schedule.errors.repeatNumbers');
    expect(cronOf({ timing: 'monthly', dayOfMonth: 32, time: at(8, 0) })).toBe('schedule.errors.repeatNumbers');
  });

  it('opens a cron on the preset that writes it back', () => {
    expect(repeatFrom('0 0 7 * * 1,3,5')).toMatchObject({ timing: 'weekly', weekdays: [1, 3, 5], time: at(7, 0) });
    expect(repeatFrom('0 30 18 * * 7')).toMatchObject({ timing: 'weekly', weekdays: [7], time: at(18, 30) });
    expect(repeatFrom('0 0 7 * * 1-5')).toMatchObject({ timing: 'weekly', weekdays: [1, 2, 3, 4, 5], time: at(7, 0) });
    expect(repeatFrom('0 0 7 * * 1-3,6,7')).toMatchObject({ timing: 'weekly', weekdays: [1, 2, 3, 6, 7] });
    expect(repeatFrom('0 0 9 15 * *')).toMatchObject({ timing: 'monthly', dayOfMonth: 15, time: at(9, 0) });
    expect(repeatFrom('0 10 */4 * * *')).toMatchObject({ timing: 'hourly', everyHours: 4, minute: 10 });
    expect(repeatFrom('0 0 7 * * *')).toMatchObject({ timing: 'daily', time: at(7, 0) });
  });

  /** Anything the presets would write differently stays as the Pond has it, so a save loses nothing. */
  it('opens anything else as custom, with the cron untouched', () => {
    for (const cron of [
      '0 0 7 * * 1,2,3,4,5', // a run the picker writes as 1-5
      '0 0 7 * * 6-7', // a two-day run the picker writes as 6,7
      '0 0 7 * * 5,1', // days out of week order
      '0 0 7 * * 0', // Sunday as 0
      '0 07 7 * * *', // a padded minute
      '30 0 7 * * *', // a second other than 0
      '0 */15 * * * *', // every 15 minutes
      '0 0 */24 * * *', // more hours than the picker offers
      '0 0 9 1 1 *', // once a year
      '0 0 9 * * 1 2027', // a seventh field
      '0 9 * * *', // five fields
    ]) {
      expect(repeatFrom(cron)).toMatchObject({ timing: 'custom', cron });
    }
  });

  it('previews a draft as the cron it would send, and nothing until it is complete', () => {
    expect(draftCron(draft({ timing: 'weekly', weekdays: [1, 2, 3, 4, 5], time: at(7, 0) }))).toBe('0 0 7 * * 1-5');
    expect(describeCron('0 0 7 * * 1-5')).toBe('Weekdays at 07:00');
    expect(draftCron(draft({ timing: 'daily', time: null }))).toBeNull();
    expect(draftCron(draft({ timing: 'custom', cron: '0 9 * * *' }))).toBeNull();
  });

  /** Opening a schedule on its preset and saving it unchanged sends nothing about when. */
  it('sends no cron for an edit that leaves the time alone', () => {
    const weekly = schedule({ cron: '0 0 7 * * 1,3,5', timezone: 'Africa/Nairobi' });
    expect(updateRequest(weekly, draftFrom(weekly), now)).toEqual({ ok: true, req: {} });
    expect(updateRequest(weekly, { ...draftFrom(weekly), timing: 'custom' }, now)).toEqual({ ok: true, req: {} });
    expect(updateRequest(weekly, { ...draftFrom(weekly), weekdays: [1, 3, 5, 6] }, now)).toEqual({
      ok: true,
      req: { cron: '0 0 7 * * 1,3,5,6' },
    });
    // A cron the form would refuse still allows an edit to the name.
    const odd = schedule({ cron: '0 0 9 * * 1 2027', timezone: 'Africa/Nairobi' });
    expect(updateRequest(odd, { ...draftFrom(odd), name: 'Renamed' }, now)).toEqual({
      ok: true,
      req: { name: 'Renamed' },
    });
  });
});

describe('asking about a missed run', () => {
  const now = new Date(2026, 9, 24, 12, 0);
  const daily = schedule({ label: 'Morning', cron: '0 30 6 * * *', ask_if_missed: false });
  const repeat = (over: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
    ...emptyDraft('Africa/Nairobi', true),
    name: 'Morning',
    prompt: 'Lights on',
    timing: 'custom',
    cron: '0 30 6 * * *',
    ...over,
  });

  it('is offered only by a Pond whose schedules say whether they ask', () => {
    expect(pondAsksIfMissed([schedule({})])).toBe(false);
    expect(pondAsksIfMissed([schedule({}), daily])).toBe(true);
    expect(emptyDraft('UTC').askIfMissed).toBeNull();
    expect(emptyDraft('UTC', true).askIfMissed).toBe(true);
  });

  it('is sent for a new repeat, and never for a one-off or by an older Pond', () => {
    expect(createRequest(repeat(), now)).toMatchObject({ ok: true, req: { ask_if_missed: true } });
    const once = repeat({ timing: 'once', date: { year: 2026, month: 10, day: 25 }, time: { hour: 6, minute: 30 } });
    const built = createRequest(once, now);
    expect(built.ok && 'ask_if_missed' in built.req).toBe(false);
    const older = createRequest(repeat({ askIfMissed: null }), now);
    expect(older.ok && 'ask_if_missed' in older.req).toBe(false);
  });

  it('is sent on an edit only when it changed', () => {
    expect(draftFrom(daily).askIfMissed).toBe(false);
    expect(updateRequest(daily, draftFrom(daily), now)).toEqual({ ok: true, req: {} });
    expect(updateRequest(daily, { ...draftFrom(daily), askIfMissed: true }, now)).toEqual({
      ok: true,
      req: { ask_if_missed: true },
    });
  });
});

describe('routines', () => {
  const now = new Date(2026, 9, 24, 12, 0);
  const routine = (over: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
    ...emptyDraft('Africa/Nairobi', true),
    name: 'Morning',
    does: 'routine',
    devices: { 'kitchen-lights': true, 'water-heater': true },
    timing: 'custom',
    cron: '0 30 6 * * *',
    ...over,
  });
  const morning = schedule({
    label: 'Morning',
    cron: '0 30 6 * * *',
    ask_if_missed: true,
    kind: {
      type: 'routine',
      actions: [
        { type: 'device_power', device_id: 'kitchen-lights', on: true },
        { type: 'notify', title: 'Morning', body: 'Kettle is on' },
      ],
    },
  });

  it('sends its devices as actions, with no prompt', () => {
    const built = createRequest(routine(), now);
    expect(built).toMatchObject({
      ok: true,
      req: {
        kind: {
          type: 'routine',
          actions: [
            { type: 'device_power', device_id: 'kitchen-lights', on: true },
            { type: 'device_power', device_id: 'water-heater', on: true },
          ],
        },
      },
    });
    expect(built.ok && 'prompt' in built.req).toBe(false);
  });

  it('needs at least one device', () => {
    expect(createRequest(routine({ devices: {} }), now)).toEqual({ ok: false, error: 'schedule.errors.devicesRequired' });
  });

  it('opens an edit on its devices, and sends them only when they changed', () => {
    const d = draftFrom(morning);
    expect(d).toMatchObject({ does: 'routine', devices: { 'kitchen-lights': true } });
    expect(updateRequest(morning, d, now)).toEqual({ ok: true, req: {} });
  });

  it('keeps what the form cannot show when its devices change', () => {
    const built = updateRequest(morning, { ...draftFrom(morning), devices: { 'kitchen-lights': false } }, now);
    expect(built).toEqual({
      ok: true,
      req: {
        kind: {
          type: 'routine',
          actions: [
            { type: 'device_power', device_id: 'kitchen-lights', on: false },
            { type: 'notify', title: 'Morning', body: 'Kettle is on' },
          ],
        },
      },
    });
  });

  it('says what it sets by name, and by id when the name is unknown', () => {
    expect(describeRoutine({ 'kitchen-lights': true, 'water-heater': false }, { 'kitchen-lights': 'Kitchen lights' })).toBe(
      'Kitchen lights on, water-heater off',
    );
  });
});
