// My Pond's words for what the Pond sends: each id in a household's words, and a word for one this
// phone does not know rather than the raw id.

import '@/services/i18n';
import type { AdminHealth, AdminReliability, AdminTask } from '@/services/types';
import {
  areaGroupLabel,
  cacheEffect,
  cacheIcon,
  cacheLabel,
  cacheTile,
  checkThreshold,
  checkValueWords,
  dayAndTime,
  dayWords,
  durationWords,
  healthSummaryWords,
  keptLine,
  powerModeWords,
  reliabilitySections,
  shareWords,
  taskMetaWords,
  taskStateTone,
} from '@/view-models/pond-admin-words';

const HEALTH: AdminHealth = {
  version: '1',
  uptime_secs: 1,
  host: { hostname: 'nano', os: 'Ubuntu', arch: 'aarch64', cpus: 6, uptime_secs: 1, load: [] },
  memory: { total_bytes: 800, available_bytes: 104, swap_total_bytes: 0, swap_free_bytes: 0 },
  disk: { total_bytes: 1000, free_bytes: 160 },
  temperatures: [{ zone: 'gpu', celsius: 74.2 }],
  process: null,
  checks: [
    { id: 'disk_space', status: 'ok' },
    { id: 'memory', status: 'ok' },
    { id: 'temperature', status: 'ok' },
  ],
};

describe('what the Pond keeps', () => {
  it('names the four parts of the bar', () => {
    expect(areaGroupLabel('models')).toBe('Models');
    expect(areaGroupLabel('engine_caches')).toBe('Engine caches');
    expect(areaGroupLabel('kv_snapshots')).toBe('Saved prompts (KV)');
    expect(areaGroupLabel('rest')).toBe('Logs, conversations, camera and the rest');
  });

  it('says why a kept entry stays, pointing at Models where that is the way to remove it', () => {
    expect(keptLine('managed_by_models')).toBe('Kept · remove a model in Models');
    expect(keptLine('in_use')).toBe('Kept · the Pond runs on it');
    expect(keptLine('protected')).toBe('Kept · the Pond runs on it');
  });
});

describe('the caches', () => {
  it('gives each its name, tile and what clearing it costs', () => {
    expect([cacheLabel('kv_snapshots'), cacheIcon('kv_snapshots'), cacheTile('kv_snapshots')]).toEqual(['Saved prompts', 'bolt', 'blue']);
    expect([cacheLabel('accelerator_caches'), cacheIcon('accelerator_caches'), cacheTile('accelerator_caches')]).toEqual([
      'Accelerator caches',
      'cpu',
      'teal',
    ]);
    expect([cacheLabel('download_leftovers'), cacheIcon('download_leftovers'), cacheTile('download_leftovers')]).toEqual([
      'Download leftovers',
      'download',
      'slate',
    ]);
    expect(cacheEffect('kv_snapshots')).toMatch(/A paused long task keeps its place/);
    expect(cacheEffect('accelerator_caches')).toMatch(/a few minutes longer, once/);
  });
});

describe('power modes', () => {
  it('says what each nvpmodel mode means for Goose, and nothing for a name it does not know', () => {
    expect(powerModeWords('7W')).toBe('Quietest and coolest. Goose takes noticeably longer to answer.');
    expect(powerModeWords('15W')).toBe('Saves power, a little slower.');
    expect(powerModeWords('25W')).toMatch(/^Same memory speed as MAXN_SUPER/);
    expect(powerModeWords('MAXN_SUPER')).toBe('Everything at full speed, and the most heat.');
    expect(powerModeWords('MAXN')).toBe('Everything at full speed, and the most heat.');
    expect(powerModeWords('10W_DESKTOP')).toBeNull();
  });
});

describe('health', () => {
  it('reads all good when every check is ok', () => {
    expect(healthSummaryWords(HEALTH)).toEqual({ status: 'ok', title: 'All good', line: 'Disk, memory and heat are in range' });
  });

  it('names the checks that need a look, at the worst of their tones', () => {
    const warm = { ...HEALTH, checks: [{ id: 'temperature', status: 'warning' }, { id: 'disk_space', status: 'critical' }] } as AdminHealth;
    expect(healthSummaryWords(warm)).toEqual({
      status: 'critical',
      title: 'Needs a look',
      line: 'Out of range: Temperature · Disk space',
    });
  });

  it('gives each check its threshold and the reading it stands on', () => {
    expect(checkThreshold('disk_space')).toBe('Warns under 10% free');
    expect(checkThreshold('temperature')).toBe('Warns at 80 °C, before the board slows itself');
    expect(checkThreshold('other')).toBeNull();
    expect(checkValueWords(HEALTH, 'disk_space', 'ok')).toBe('16% free');
    expect(checkValueWords({ ...HEALTH, disk: { total_bytes: 1000, free_bytes: 96 } }, 'disk_space', 'warning')).toBe('9% free');
    expect(checkValueWords({ ...HEALTH, disk: { total_bytes: 100, free_bytes: 29 } }, 'disk_space', 'ok')).toBe('29% free');
    expect(checkValueWords(HEALTH, 'memory', 'ok')).toBe('13% available');
    expect(checkValueWords(HEALTH, 'temperature', 'ok')).toBe('74 °C');
    expect(checkValueWords(HEALTH, 'other', 'warning')).toBe('Warning');
    expect(checkValueWords({ ...HEALTH, disk: null }, 'disk_space', 'critical')).toBe('Critical');
  });

  it('says how long the machine has been up in its two largest units', () => {
    expect(durationWords(86_400 + 19 * 3_600 + 120)).toBe('1 day 19 hours');
    expect(durationWords(2 * 3_600 + 5 * 60)).toBe('2 hours 5 minutes');
    expect(durationWords(60)).toBe('1 minute');
    expect(durationWords(40)).toBe('40 seconds');
    expect(durationWords(null)).toBeNull();
  });
});

describe('tasks', () => {
  const now = new Date(2026, 9, 29, 13, 0);
  const at = (d: Date) => d.toISOString();
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const base: AdminTask = {
    id: 't',
    goal: 'Plan a trip',
    another_member: false,
    state: 'completed',
    kind: 'research',
    created_at: null,
    finished_at: null,
    has_report: true,
    artifacts: [],
  };

  it('colours a state by how it ended, or that it has not', () => {
    expect(taskStateTone('completed')).toBe('success');
    expect(taskStateTone('failed')).toBe('danger');
    expect(taskStateTone('running')).toBe('warning');
    expect(taskStateTone('cancelled')).toBe('neutral');
    expect(taskStateTone(null)).toBe('neutral');
  });

  it('says today and yesterday in words, and a date before that', () => {
    const today = new Date(2026, 9, 29, 11, 25);
    const yesterday = new Date(2026, 9, 28, 18, 40);
    const earlier = new Date(2026, 9, 20, 9, 5);
    expect(dayAndTime(at(today), now)).toBe(`today ${time(today)}`);
    expect(dayAndTime(at(yesterday), now)).toBe(`yesterday ${time(yesterday)}`);
    expect(dayAndTime(at(earlier), now)).toBe(`${dayWords(at(earlier), now)} ${time(earlier)}`);
    expect(dayAndTime(null, now)).toBeNull();
    expect(dayAndTime('not a time', now)).toBeNull();
  });

  it('adds the year to a day only once it is not this one', () => {
    const lastYear = new Date(2025, 9, 20);
    expect(dayWords(at(lastYear), now)).toContain('2025');
    expect(dayWords(at(new Date(2026, 9, 20)), now)).not.toContain('2026');
  });

  it('says when a task ended and what it saved, and that another member keeps their words', () => {
    const ended = new Date(2026, 9, 29, 11, 25);
    const artifacts = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, title: null, kind: 'note', tokens: 1, created_at: null }));
    expect(taskMetaWords({ ...base, finished_at: at(ended), artifacts }, now)).toBe(`Finished today ${time(ended)} · 12 artifacts`);
    expect(taskMetaWords({ ...base, state: 'cancelled', finished_at: at(ended), artifacts: artifacts.slice(0, 1) }, now)).toBe(
      `Stopped today ${time(ended)} · 1 artifact`,
    );
    expect(taskMetaWords({ ...base, state: 'running', created_at: at(ended), artifacts: artifacts.slice(0, 5) }, now)).toBe(
      `Started today ${time(ended)} · 5 artifacts so far`,
    );
    expect(taskMetaWords({ ...base, another_member: true, goal: null, finished_at: at(ended), artifacts: artifacts.slice(0, 4) }, now)).toBe(
      `Finished today ${time(ended)} · 4 artifacts · its words stay theirs`,
    );
    expect(taskMetaWords({ ...base, finished_at: null }, now)).toBe('0 artifacts');
  });
});

describe('the reliability report', () => {
  const REPORT: AdminReliability = {
    days: 7,
    notices: { queued: 20, woken: 14, fetched: 19, fetched_within_a_minute: 9, fetched_after_an_hour: 2, shown: 18, opened: 6, spoken: 1 },
    turns: { asked: 40, answered: 39 },
    phones: { paired: 3, test: 0, unseen: 1, with_push_token: 2 },
    stops: 2,
    android_push_key: true,
    apple_push_key: false,
  };
  const row = (sections: ReturnType<typeof reliabilitySections>, key: string) =>
    sections.flatMap((s) => s.rows).find((r) => r.key === key);

  it('says a share as a part of a whole, rounded down as the Pond rounds it', () => {
    expect(shareWords(9, 20)).toBe('9 of 20 (45%)');
    expect(shareWords(2, 3)).toBe('2 of 3 (66%)');
    expect(shareWords(0, 0)).toBe('0');
  });

  it('reads each count in plain words, in the order the Pond prints them', () => {
    const sections = reliabilitySections(REPORT);
    expect(sections.map((s) => s.title)).toEqual(['Notices', 'Messages', 'Phones', 'Pond']);
    expect(row(sections, 'withinAMinute')).toMatchObject({ label: 'Fetched within a minute', value: '9 of 20 (45%)' });
    expect(row(sections, 'neverFetched')).toMatchObject({ value: '1', warn: true });
    expect(row(sections, 'unanswered')).toMatchObject({ label: 'Left without a reply', value: '1', warn: true });
    expect(row(sections, 'withPush')).toMatchObject({ value: '2 of 3 (66%)' });
    expect(row(sections, 'appleKey')).toMatchObject({ label: 'Apple push key', value: 'Missing', warn: true });
    expect(row(sections, 'androidKey')).toMatchObject({ value: 'Present' });
    expect(row(sections, 'androidKey')?.warn).toBeFalsy();
  });

  it('names test devices only when there are some', () => {
    expect(row(reliabilitySections(REPORT), 'test')).toBeUndefined();
    expect(row(reliabilitySections({ ...REPORT, phones: { ...REPORT.phones, test: 1 } }), 'test')).toMatchObject({ value: '1' });
  });

  it('flags nothing when everything arrived and was answered', () => {
    const fine = reliabilitySections({
      ...REPORT,
      notices: { ...REPORT.notices, fetched: 20 },
      turns: { asked: 40, answered: 40 },
      apple_push_key: true,
    });
    expect(fine.flatMap((s) => s.rows).filter((r) => r.warn)).toEqual([]);
  });
});
