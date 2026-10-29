// The readers stand between the Pond's JSON and the screens: whatever arrives, a screen gets a shape
// it can draw, and an unknown value reads as the safest thing it could mean.

import {
  adminPasswordProblem,
  breadcrumbs,
  diskUsed,
  formatAdminPassword,
  healthNeedsAttention,
  isTaskFinished,
  minutesLeft,
  normalizeAdminPassword,
  readAdminStatus,
  readCaches,
  readFileListing,
  readFreed,
  readHealth,
  readModeChange,
  readOverview,
  readPower,
  readTasks,
  readUnlocked,
  sizeWords,
} from '@/models/pond-admin';

const GARBAGE: unknown[] = [null, undefined, 42, 'text', true, [], [1, 2]];

describe('the card password', () => {
  it('reads as the Pond reads it: any case, no dashes or spaces, O as 0 and I or L as 1', () => {
    expect(normalizeAdminPassword('goos-eina-pond-2026')).toBe('G00SE1NAP0ND2026');
    expect(normalizeAdminPassword(' g00s e1na\tp0nd 2026 ')).toBe('G00SE1NAP0ND2026');
    expect(normalizeAdminPassword('l-i-o')).toBe('110');
  });

  it('is shown in the card groups as it is typed', () => {
    expect(formatAdminPassword('goose')).toBe('G00S-E');
    expect(formatAdminPassword('G00S-')).toBe('G00S');
    expect(formatAdminPassword('goos eina pond 2026')).toBe('G00S-E1NA-P0ND-2026');
    expect(formatAdminPassword('')).toBe('');
  });

  it('is sent only as sixteen Crockford characters', () => {
    expect(adminPasswordProblem('')).toBe('empty');
    expect(adminPasswordProblem('---')).toBe('empty');
    expect(adminPasswordProblem('G00S-E1NA')).toBe('short');
    expect(adminPasswordProblem('G00S-E1NA-P0ND-20261')).toBe('long');
    // U is not on a Crockford card, and nor is punctuation.
    expect(adminPasswordProblem('U00S-E1NA-P0ND-2026')).toBe('not_on_card');
    expect(adminPasswordProblem('G00S-E1NA-P0ND-202!')).toBe('not_on_card');
    expect(adminPasswordProblem('goos-eina-pond-2026')).toBeNull();
  });
});

describe('readAdminStatus', () => {
  it('reads the status', () => {
    expect(readAdminStatus({ card: 'present', unlocked: true, expires_at: '2026-10-29T10:00:00Z', idle_minutes: 15, retry_after: null })).toEqual({
      card: 'present',
      unlocked: true,
      expires_at: '2026-10-29T10:00:00Z',
      idle_minutes: 15,
      retry_after: null,
    });
  });

  it('reads anything unclear as locked, with a card, and no wait', () => {
    expect(readAdminStatus({ card: 'lost', unlocked: 'yes', idle_minutes: -1, retry_after: 'soon' })).toEqual({
      card: 'present',
      unlocked: false,
      expires_at: null,
      idle_minutes: 15,
      retry_after: null,
    });
    expect(readAdminStatus({ card: 'missing', unlocked: false, retry_after: 12.2 })).toMatchObject({ card: 'missing', retry_after: 13 });
  });

  it('is null for a body that is not one', () => {
    for (const raw of GARBAGE) expect(readAdminStatus(raw)).toBeNull();
  });

  it('reads an unlock only when it says unlocked', () => {
    expect(readUnlocked({ unlocked: true, expires_at: 'x' })).toEqual({ unlocked: true, expires_at: 'x' });
    expect(readUnlocked({ unlocked: false })).toBeNull();
    for (const raw of GARBAGE) expect(readUnlocked(raw)).toBeNull();
  });
});

describe('readOverview', () => {
  it('reads areas largest first, folding ids this phone does not know into one Other', () => {
    const overview = readOverview({
      disk: { total_bytes: 1000, free_bytes: 200 },
      data_dir_bytes: 600,
      areas: [
        { id: 'logs', bytes: 50 },
        { id: 'models', bytes: 400 },
        { id: 'quantum_foam', bytes: 30 },
        { id: 'other', bytes: 20 },
        { id: 'camera' },
        null,
      ],
      databases: [{ name: 'pond_system.db', bytes: 90 }, { bytes: 4 }],
      counts: { sessions: 3, messages: 'many', memories: 2, long_tasks: 1, artifacts: 4, models: 2 },
    });
    expect(overview?.areas).toEqual([
      { id: 'models', bytes: 400 },
      { id: 'logs', bytes: 50 },
      { id: 'other', bytes: 50 },
      { id: 'camera', bytes: 0 },
    ]);
    expect(overview?.databases).toEqual([{ name: 'pond_system.db', bytes: 90 }]);
    expect(overview?.counts).toEqual({ sessions: 3, messages: null, memories: 2, long_tasks: 1, artifacts: 4, models: 2 });
  });

  it('draws an empty overview from an object missing everything', () => {
    expect(readOverview({})).toEqual({
      disk: { total_bytes: 0, free_bytes: 0 },
      data_dir_bytes: 0,
      areas: [],
      databases: [],
      counts: { sessions: null, messages: null, memories: null, long_tasks: null, artifacts: null, models: null },
    });
    for (const raw of GARBAGE) expect(readOverview(raw)).toBeNull();
  });

  it('never reports more free space than the disk holds', () => {
    expect(readOverview({ disk: { total_bytes: 10, free_bytes: 50 } })?.disk).toEqual({ total_bytes: 10, free_bytes: 10 });
  });
});

describe('readFileListing', () => {
  it('reads entries largest first, and an entry that cannot be deleted always says why', () => {
    const listing = readFileListing(
      {
        path: 'engine',
        entries: [
          { name: 'a', path: 'engine/a', kind: 'file', bytes: 10, modified_at: 't', deletable: true, reason: null },
          { name: 'kv', path: 'engine/kv', kind: 'directory', bytes: 900, deletable: false, reason: 'in_use' },
          { name: 'm', path: 'engine/m', kind: 'socket', bytes: 5, deletable: false, reason: 'because' },
          { name: 'x', path: 'engine/x', kind: 'file', bytes: 20, deletable: 'yes', reason: 'managed_by_models' },
          { name: '', path: 'engine/' },
          { path: 'engine/nameless' },
        ],
      },
      'engine',
    );
    expect(listing?.entries.map((e) => [e.name, e.kind, e.bytes, e.deletable, e.reason])).toEqual([
      ['kv', 'directory', 900, false, 'in_use'],
      ['x', 'file', 20, false, 'managed_by_models'],
      ['a', 'file', 10, true, null],
      ['m', 'file', 5, false, 'protected'],
    ]);
  });

  it('keeps the asked path when the Pond names none, and refuses a body with no entries', () => {
    expect(readFileListing({ entries: [] }, 'logs')).toEqual({ path: 'logs', entries: [] });
    expect(readFileListing({ path: '' }, '')).toBeNull();
    for (const raw of GARBAGE) expect(readFileListing(raw, '')).toBeNull();
  });
});

describe('readCaches and readFreed', () => {
  it('offers only the caches this phone can describe', () => {
    expect(
      readCaches({
        caches: [
          { id: 'kv_snapshots', bytes: 5, files: 2 },
          { id: 'mystery', bytes: 9, files: 1 },
          { id: 'download_leftovers' },
          'junk',
        ],
      }),
    ).toEqual([
      { id: 'kv_snapshots', bytes: 5, files: 2 },
      { id: 'download_leftovers', bytes: 0, files: 0 },
    ]);
    for (const raw of GARBAGE) expect(readCaches(raw)).toBeNull();
  });

  it('reads freed bytes, zero when the Pond did not say', () => {
    expect(readFreed({ freed_bytes: 12 })).toBe(12);
    expect(readFreed({ freed_bytes: -4 })).toBe(0);
    for (const raw of GARBAGE) expect(readFreed(raw)).toBe(0);
  });
});

describe('readTasks', () => {
  it('reads tasks, and never shows another member goal or artifact titles, whatever was sent', () => {
    const tasks = readTasks({
      tasks: [
        {
          id: 'mine',
          goal: 'Plan a trip',
          another_member: false,
          state: 'completed',
          kind: 'research',
          created_at: 'a',
          finished_at: 'b',
          has_report: true,
          artifacts: [{ id: 'ar1', title: 'Plan', kind: 'note', tokens: 10, created_at: 'a' }, { title: 'no id' }],
        },
        {
          id: 'theirs',
          goal: 'Their secret',
          another_member: true,
          state: 'running',
          kind: 'general',
          artifacts: [{ id: 'ar2', title: 'Their title', kind: 'draft', tokens: 3 }],
        },
        { id: 'odd', state: 'teleporting', kind: 'magic', has_report: 'yes' },
        { goal: 'no id' },
      ],
    });
    expect(tasks?.map((t) => [t.id, t.goal, t.another_member, t.state, t.kind, t.has_report, t.artifacts.map((a) => a.title)])).toEqual([
      ['mine', 'Plan a trip', false, 'completed', 'research', true, ['Plan']],
      ['theirs', null, true, 'running', 'general', false, [null]],
      ['odd', null, false, null, 'general', false, []],
    ]);
    for (const raw of GARBAGE) expect(readTasks(raw)).toBeNull();
  });

  it('takes only an ended task for finished, and never one in a state it does not know', () => {
    expect(isTaskFinished('completed')).toBe(true);
    expect(isTaskFinished('failed')).toBe(true);
    expect(isTaskFinished('cancelled')).toBe(true);
    expect(isTaskFinished('running')).toBe(false);
    expect(isTaskFinished('paused')).toBe(false);
    expect(isTaskFinished(null)).toBe(false);
  });
});

describe('readHealth', () => {
  it('reads checks, taking an unknown status as a warning and an unknown id as another check', () => {
    const health = readHealth({
      version: '1.2.3',
      uptime_secs: 60,
      host: { hostname: 'nano', os: 'Ubuntu', arch: 'aarch64', cpus: 6, uptime_secs: 99, load: [1, 'x', 2, 3, 4] },
      memory: { total_bytes: 8, available_bytes: 1 },
      disk: { total_bytes: 10, free_bytes: 1 },
      temperatures: [{ zone: 'cpu', celsius: 50 }, { zone: 'gpu', celsius: 'hot' }],
      process: { rss_bytes: 3 },
      checks: [
        { id: 'disk_space', status: 'critical' },
        { id: 'fans', status: 'ok' },
        { id: 'memory', status: 'unsure' },
        'junk',
      ],
    });
    expect(health?.host.load).toEqual([1, 2, 3]);
    expect(health?.memory).toEqual({ total_bytes: 8, available_bytes: 1, swap_total_bytes: 0, swap_free_bytes: 0 });
    expect(health?.temperatures).toEqual([{ zone: 'cpu', celsius: 50 }]);
    expect(health?.checks).toEqual([
      { id: 'disk_space', status: 'critical' },
      { id: 'other', status: 'ok' },
      { id: 'memory', status: 'warning' },
    ]);
    expect(healthNeedsAttention(health)).toBe(true);
  });

  it('draws a health page from an object missing everything', () => {
    const health = readHealth({});
    expect(health).toMatchObject({ version: '', uptime_secs: null, memory: null, disk: null, process: null, temperatures: [], checks: [] });
    expect(healthNeedsAttention(health)).toBe(false);
    expect(healthNeedsAttention(null)).toBe(false);
    for (const raw of GARBAGE) expect(readHealth(raw)).toBeNull();
  });
});

describe('readPower', () => {
  it('reads the power report', () => {
    expect(
      readPower({
        control: 'nvpmodel',
        mode: { id: 1, name: '25W' },
        default_mode_id: 1,
        modes: [{ id: 0, name: '15W' }, { id: 1, name: '25W' }, { name: 'no id' }],
        can_change: true,
        supply: { millivolts: 19000, milliamps: 500, milliwatts: 9500 },
        battery: { percent: 140, charging: true },
      }),
    ).toEqual({
      control: 'nvpmodel',
      mode: { id: 1, name: '25W' },
      default_mode_id: 1,
      modes: [{ id: 0, name: '15W' }, { id: 1, name: '25W' }],
      can_change: true,
      supply: { millivolts: 19000, milliamps: 500, milliwatts: 9500 },
      battery: { percent: 100, charging: true },
    });
  });

  it('reads an unknown control as none, which cannot be changed whatever can_change says', () => {
    expect(readPower({ control: 'acpi', can_change: true })).toMatchObject({ control: 'none', can_change: false, mode: null, modes: [], supply: null, battery: null });
    for (const raw of GARBAGE) expect(readPower(raw)).toBeNull();
  });

  it('reads a mode change, needing no restart unless the Pond says so', () => {
    expect(readModeChange({ mode: { id: 3, name: '7W' }, reboot_required: true })).toEqual({ mode: { id: 3, name: '7W' }, reboot_required: true });
    expect(readModeChange({})).toEqual({ mode: null, reboot_required: false });
    for (const raw of GARBAGE) expect(readModeChange(raw)).toBeNull();
  });
});

describe('the small pieces', () => {
  it('names each folder on the way down from the data folder', () => {
    expect(breadcrumbs('')).toEqual([{ name: null, path: '' }]);
    expect(breadcrumbs('engine/kv/suspended')).toEqual([
      { name: null, path: '' },
      { name: 'engine', path: 'engine' },
      { name: 'kv', path: 'engine/kv' },
      { name: 'suspended', path: 'engine/kv/suspended' },
    ]);
  });

  it('says sizes in human units', () => {
    expect(sizeWords(0)).toBe('0 B');
    expect(sizeWords(1023)).toBe('1023 B');
    expect(sizeWords(1024)).toBe('1.0 KB');
    expect(sizeWords(15 * 1024 * 1024)).toBe('15 MB');
    expect(sizeWords(4.4 * 1024 ** 3)).toBe('4.4 GB');
    expect(sizeWords(2 * 1024 ** 4)).toBe('2.0 TB');
    expect(sizeWords(Number.NaN)).toBe('0 B');
  });

  it('measures the disk, and an unmeasured one as empty', () => {
    expect(diskUsed({ total_bytes: 100, free_bytes: 25 })).toEqual({ used: 75, fraction: 0.75 });
    expect(diskUsed({ total_bytes: 0, free_bytes: 0 })).toEqual({ used: 0, fraction: 0 });
  });

  it('counts whole minutes to the lock, rounding up', () => {
    const now = Date.parse('2026-10-29T10:00:00Z');
    expect(minutesLeft('2026-10-29T10:15:00Z', now)).toBe(15);
    expect(minutesLeft('2026-10-29T10:00:01Z', now)).toBe(1);
    expect(minutesLeft('2026-10-29T09:59:00Z', now)).toBe(0);
    expect(minutesLeft(null, now)).toBeNull();
    expect(minutesLeft('not a time', now)).toBeNull();
  });
});
