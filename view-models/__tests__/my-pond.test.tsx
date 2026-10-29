// My Pond's view-models against a mocked client: the lock and what moves it, how often the status is
// read, and that nothing destructive is sent without a yes.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { MOCK_ADMIN_PASSWORD } from '@/models/pond-admin-mock';
import { ApiError, api } from '@/services/api-client';
import type { AdminFileListing, AdminOverview, AdminHealth, AdminPower, AdminStatus } from '@/services/types';
import { resetMockPondAdmin } from '@/view-models/pond-admin-source';
import { resetAdminGates, useAdminUnlock } from '@/view-models/use-admin-gate';
import { ADMIN_STATUS_MS, useMyPond } from '@/view-models/use-my-pond';
import { usePondFiles } from '@/view-models/use-pond-files';
import { usePondPower } from '@/view-models/use-pond-power';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect: run } = jest.requireActual('react');
    run(effect, [effect]);
  },
}));
const server = { hydrated: true, online: true, real: true, isScreenReal: () => server.real };
jest.mock('@/providers/server-provider', () => ({ useServer: () => server }));
const mockAsk = jest.fn<Promise<boolean>, [{ title: string; message: string; confirmLabel: string; destructive?: boolean }]>();
jest.mock('@/providers/confirm-provider', () => ({ useConfirm: () => mockAsk }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      adminStatus: jest.fn(),
      adminUnlock: jest.fn(),
      adminLock: jest.fn(),
      adminOverview: jest.fn(),
      adminFiles: jest.fn(),
      adminDeleteFile: jest.fn(),
      adminHealth: jest.fn(),
      adminPower: jest.fn(),
      adminSetPowerMode: jest.fn(),
      adminRestart: jest.fn(),
    },
  };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOCKED: AdminStatus = { card: 'present', unlocked: false, expires_at: null, idle_minutes: 15, retry_after: null, key: false };
const OPEN: AdminStatus = { ...LOCKED, unlocked: true, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() };
const OVERVIEW: AdminOverview = {
  disk: { total_bytes: 1000, free_bytes: 250 },
  data_dir_bytes: 600,
  areas: [
    { id: 'models', bytes: 500 },
    { id: 'logs', bytes: 100 },
  ],
  databases: [],
  counts: { sessions: 3, messages: 40, memories: 5, long_tasks: 2, artifacts: 6, models: 2 },
};
const HEALTH: AdminHealth = {
  version: '1',
  uptime_secs: 10,
  host: { hostname: 'nano', os: '', arch: '', cpus: 6, uptime_secs: 10, load: [] },
  memory: null,
  disk: null,
  temperatures: [],
  process: null,
  checks: [
    { id: 'disk_space', status: 'warning' },
    { id: 'memory', status: 'ok' },
  ],
};
const ROOT: AdminFileListing = {
  path: '',
  entries: [
    { name: 'old.tar.gz', path: 'old.tar.gz', kind: 'file', bytes: 2048, modified_at: null, deletable: true, reason: null },
    { name: 'pond_system.db', path: 'pond_system.db', kind: 'file', bytes: 1024, modified_at: null, deletable: false, reason: 'in_use' },
  ],
};
const POWER: AdminPower = {
  control: 'nvpmodel',
  mode: { id: 1, name: '25W' },
  default_mode_id: 1,
  modes: [
    { id: 0, name: '15W' },
    { id: 1, name: '25W' },
  ],
  can_change: true,
  supply: null,
  battery: null,
};

function refused(status: number, error: string, extra: Record<string, unknown> = {}, retryAfter: number | null = null) {
  return new ApiError(`admin → ${status}`, status, retryAfter, error, { error, ...extra });
}

const flush = () => act(async () => jest.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(async () => jest.advanceTimersByTimeAsync(ms));

async function mount<T>(hook: () => T) {
  let latest!: T;
  const Probe = () => {
    latest = hook();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  await flush();
  return {
    get vm() {
      return latest;
    },
    unmount: () => act(() => tree.unmount()),
  };
}

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  resetAdminGates();
  resetMockPondAdmin();
  server.real = true;
  pond.adminStatus.mockResolvedValue(LOCKED);
  pond.adminOverview.mockResolvedValue(OVERVIEW);
  pond.adminHealth.mockResolvedValue(HEALTH);
  pond.adminFiles.mockResolvedValue(ROOT);
  pond.adminLock.mockResolvedValue(undefined);
  pond.adminPower.mockResolvedValue(POWER);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  warn.mockRestore();
});

describe('the lock', () => {
  it('asks the status on arrival and then every 30 s, and reads nothing else while locked', async () => {
    const m = await mount(useMyPond);
    expect(m.vm.gate.phase).toBe('locked');
    expect(pond.adminStatus).toHaveBeenCalledTimes(1);
    await advance(ADMIN_STATUS_MS - 1);
    expect(pond.adminStatus).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(pond.adminStatus).toHaveBeenCalledTimes(2);
    expect(pond.adminOverview).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('unlocks with the card as the Pond reads it, then reads the overview and health once', async () => {
    pond.adminUnlock.mockResolvedValue({ unlocked: true, expires_at: OPEN.expires_at });
    const m = await mount(() => ({ tab: useMyPond(), form: useAdminUnlock() }));
    await act(async () => m.vm.form.setPassword('goos eina pond 2026'));
    expect(m.vm.form.password).toBe('G00S-E1NA-P0ND-2026');
    expect(m.vm.form.problem).toBeNull();

    await act(async () => {
      expect(await m.vm.form.unlock()).toBe(true);
    });
    await flush();
    expect(pond.adminUnlock).toHaveBeenCalledWith('G00SE1NAP0ND2026');
    expect(m.vm.tab.gate.phase).toBe('unlocked');
    expect(m.vm.form.password).toBe('');
    expect(pond.adminOverview).toHaveBeenCalledTimes(1);
    expect(pond.adminHealth).toHaveBeenCalledTimes(1);
    expect(m.vm.tab.disk).toEqual({ used: 750, total: 1000, free: 250, fraction: 0.75 });
    expect(m.vm.tab.parts).toEqual([
      { id: 'models', bytes: 500 },
      { id: 'engine_caches', bytes: 0 },
      { id: 'kv_snapshots', bytes: 0 },
      { id: 'rest', bytes: 100 },
    ]);
    expect(m.vm.tab.healthWarning).toBe(true);
    expect(m.vm.tab.healthStatus).toBe('warning');
    expect(m.vm.tab.locksIn).toBe(15);

    // The poll reads the status alone: anything else would keep My Pond open for good.
    pond.adminStatus.mockResolvedValue(OPEN);
    await advance(ADMIN_STATUS_MS);
    expect(pond.adminOverview).toHaveBeenCalledTimes(1);

    await act(async () => {
      expect(await m.vm.tab.actions.lock()).toBe(true);
    });
    expect(pond.adminLock).toHaveBeenCalledTimes(1);
    expect(m.vm.tab.gate.phase).toBe('locked');
    expect(m.vm.tab.overview).toBeNull();
    await m.unmount();
  });

  it('sends nothing until the password is sixteen characters from the card', async () => {
    const m = await mount(useAdminUnlock);
    await act(async () => m.vm.setPassword('G00S-E1NA'));
    expect(m.vm.problem).toBe('short');
    expect(m.vm.typed).toBe(8);
    await act(async () => {
      expect(await m.vm.unlock()).toBe(false);
    });
    await act(async () => m.vm.setPassword('U00S-E1NA-P0ND-2026'));
    expect(m.vm.problem).toBe('not_on_card');
    await act(async () => {
      await m.vm.unlock();
    });
    expect(pond.adminUnlock).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('says a wrong card in words, and reads the status to learn whether the Pond is now slowing guesses', async () => {
    pond.adminUnlock.mockRejectedValue(refused(403, 'admin_password_rejected'));
    const m = await mount(() => ({ tab: useMyPond(), form: useAdminUnlock() }));
    await act(async () => m.vm.form.setPassword('AAAA-AAAA-AAAA-AAAA'));
    pond.adminStatus.mockResolvedValue({ ...LOCKED, retry_after: 30 });
    await act(async () => {
      expect(await m.vm.form.unlock()).toBe(false);
    });
    await flush();
    expect(m.vm.form.error).toBe("That isn't the password on this Pond's administrator card.");
    expect(pond.adminStatus).toHaveBeenCalledTimes(2);
    expect(m.vm.tab.gate.phase).toBe('locked');
    expect(m.vm.form.coolingSecs).toBe(30);
    await m.unmount();
  });

  it('counts down a cooling Pond and sends nothing until it has passed', async () => {
    pond.adminUnlock.mockRejectedValue(refused(429, 'admin_cooling', { retry_after: 20 }, 20));
    const m = await mount(() => ({ tab: useMyPond(), form: useAdminUnlock() }));
    await act(async () => m.vm.form.setPassword(MOCK_ADMIN_PASSWORD));
    await act(async () => {
      await m.vm.form.unlock();
    });
    await flush();
    expect(m.vm.form.coolingSecs).toBe(20);
    expect(m.vm.form.error).toBeNull();

    await advance(5_000);
    expect(m.vm.form.coolingSecs).toBe(15);
    await act(async () => {
      expect(await m.vm.form.unlock()).toBe(false);
    });
    expect(pond.adminUnlock).toHaveBeenCalledTimes(1);

    await advance(15_000);
    expect(m.vm.form.coolingSecs).toBe(0);
    pond.adminUnlock.mockResolvedValue({ unlocked: true, expires_at: OPEN.expires_at });
    await act(async () => {
      expect(await m.vm.form.unlock()).toBe(true);
    });
    expect(pond.adminUnlock).toHaveBeenCalledTimes(2);
    await m.unmount();
  });

  it('starts the countdown from a status that says the Pond is cooling', async () => {
    pond.adminStatus.mockResolvedValue({ ...LOCKED, retry_after: 45 });
    const m = await mount(() => ({ tab: useMyPond(), form: useAdminUnlock() }));
    await flush();
    expect(m.vm.form.coolingSecs).toBe(45);
    await m.unmount();
  });

  it('says when the Pond has no card', async () => {
    pond.adminStatus.mockResolvedValue({ ...LOCKED, card: 'missing' });
    const m = await mount(useMyPond);
    expect(m.vm.gate.phase).toBe('no_card');
    await m.unmount();
  });

  it('says when this phone is not a member, and stops asking', async () => {
    pond.adminStatus.mockRejectedValue(refused(403, 'admin_members_only'));
    const m = await mount(useMyPond);
    expect(m.vm.gate.phase).toBe('members_only');
    // A guest phone stays one; asking again every 30 s would only spend the Pond's budget.
    await advance(ADMIN_STATUS_MS * 3);
    expect(pond.adminStatus).toHaveBeenCalledTimes(1);
    await m.unmount();
  });

  it('reads a Pond without the admin routes as one that predates My Pond, and stops asking', async () => {
    pond.adminStatus.mockRejectedValue(new ApiError('GET → 404', 404, null));
    const m = await mount(useMyPond);
    expect(m.vm.gate.phase).toBe('unsupported');
    await advance(ADMIN_STATUS_MS * 3);
    expect(pond.adminStatus).toHaveBeenCalledTimes(1);
    await m.unmount();
  });

  it('notices a lock that lapsed while My Pond was open', async () => {
    pond.adminStatus.mockResolvedValue(OPEN);
    const m = await mount(useMyPond);
    expect(m.vm.gate.phase).toBe('unlocked');
    pond.adminStatus.mockResolvedValue(LOCKED);
    await advance(ADMIN_STATUS_MS);
    expect(m.vm.gate.phase).toBe('locked');
    await m.unmount();
  });
});

describe('admin_locked anywhere', () => {
  it('returns the whole area to the lock, and an unlock reads the screen again', async () => {
    pond.adminStatus.mockResolvedValue(OPEN);
    const tab = await mount(() => ({ tab: useMyPond(), form: useAdminUnlock() }));
    expect(tab.vm.tab.gate.phase).toBe('unlocked');

    // The unlock lapsed on the Pond; the Files screen is the first to hear of it.
    pond.adminStatus.mockResolvedValue(LOCKED);
    pond.adminFiles.mockRejectedValue(refused(403, 'admin_locked'));
    const files = await mount(usePondFiles);
    expect(files.vm.gate.phase).toBe('locked');
    expect(tab.vm.tab.gate.phase).toBe('locked');
    expect(tab.vm.tab.overview).toBeNull();
    expect(files.vm.error).toBeNull();
    expect(files.vm.failed).toBe(false);

    pond.adminFiles.mockResolvedValue(ROOT);
    pond.adminUnlock.mockResolvedValue({ unlocked: true, expires_at: OPEN.expires_at });
    await act(async () => tab.vm.form.setPassword(MOCK_ADMIN_PASSWORD));
    await act(async () => {
      await tab.vm.form.unlock();
    });
    await flush();
    expect(files.vm.gate.phase).toBe('unlocked');
    expect(files.vm.entries.map((e) => e.name)).toEqual(['old.tar.gz', 'pond_system.db']);
    await files.unmount();
    await tab.unmount();
  });
});

describe('deleting a file', () => {
  it('asks first, naming the entry and its size, and sends nothing on Cancel', async () => {
    pond.adminStatus.mockResolvedValue(OPEN);
    const m = await mount(usePondFiles);
    mockAsk.mockResolvedValue(false);
    await act(async () => {
      expect(await m.vm.actions.remove(ROOT.entries[0])).toBe(false);
    });
    expect(mockAsk).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Delete old.tar.gz?', message: expect.stringContaining('2.0 KB'), destructive: true }),
    );
    expect(pond.adminDeleteFile).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('deletes on yes, says what it freed, and reads the folder again', async () => {
    pond.adminStatus.mockResolvedValue(OPEN);
    pond.adminDeleteFile.mockResolvedValue(2048);
    const m = await mount(usePondFiles);
    expect(pond.adminFiles).toHaveBeenCalledTimes(1);
    mockAsk.mockResolvedValue(true);
    await act(async () => {
      expect(await m.vm.actions.remove(ROOT.entries[0])).toBe(true);
    });
    expect(pond.adminDeleteFile).toHaveBeenCalledWith('old.tar.gz');
    expect(pond.adminFiles).toHaveBeenCalledTimes(2);
    expect(m.vm.notice).toBe('Deleted old.tar.gz and freed 2.0 KB.');
    await m.unmount();
  });

  it('never asks about an entry the Pond keeps', async () => {
    pond.adminStatus.mockResolvedValue(OPEN);
    const m = await mount(usePondFiles);
    await act(async () => {
      expect(await m.vm.actions.remove(ROOT.entries[1])).toBe(false);
    });
    expect(mockAsk).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('says why the Pond refused one', async () => {
    pond.adminStatus.mockResolvedValue(OPEN);
    pond.adminDeleteFile.mockRejectedValue(refused(403, 'protected_path', { reason: 'managed_by_models' }));
    const m = await mount(usePondFiles);
    mockAsk.mockResolvedValue(true);
    await act(async () => {
      await m.vm.actions.remove(ROOT.entries[0]);
    });
    expect(m.vm.error).toBe('Removed through Models, not here.');
    await m.unmount();
  });

  it('opens folders and walks back up by the crumbs', async () => {
    pond.adminStatus.mockResolvedValue(OPEN);
    const m = await mount(usePondFiles);
    pond.adminFiles.mockResolvedValue({ path: 'engine/kv', entries: [] });
    await act(async () => m.vm.actions.open({ ...ROOT.entries[0], name: 'kv', path: 'engine/kv', kind: 'directory' }));
    await flush();
    expect(pond.adminFiles).toHaveBeenLastCalledWith('engine/kv');
    expect(m.vm.crumbs.map((c) => c.path)).toEqual(['', 'engine', 'engine/kv']);
    pond.adminFiles.mockResolvedValue(ROOT);
    await act(async () => m.vm.actions.goTo(''));
    await flush();
    expect(m.vm.path).toBe('');
    expect(m.vm.entries).toHaveLength(2);
    await m.unmount();
  });
});

describe('restarting', () => {
  it('asks again when a long task is running, and sends force only on the second yes', async () => {
    pond.adminStatus.mockResolvedValue(OPEN);
    pond.adminRestart.mockImplementation(async (force: boolean) => {
      if (!force) throw refused(409, 'long_task_running');
    });
    const m = await mount(usePondPower);
    mockAsk.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    await act(async () => {
      expect(await m.vm.actions.restart()).toBe(true);
    });
    expect(pond.adminRestart.mock.calls).toEqual([[false], [true]]);
    expect(mockAsk).toHaveBeenCalledTimes(2);
    expect(mockAsk.mock.calls[1][0]).toMatchObject({ title: 'A long task is running', destructive: true });
    expect(mockAsk.mock.calls[1][0].message).toMatch(/loses the step/);
    // A restart ends every unlock.
    expect(m.vm.gate.phase).toBe('locked');
    expect(m.vm.gate.restarting).toBe(true);
    await m.unmount();
  });

  it('sends no force when the second question is declined', async () => {
    pond.adminStatus.mockResolvedValue(OPEN);
    pond.adminRestart.mockRejectedValue(refused(409, 'long_task_running'));
    const m = await mount(usePondPower);
    mockAsk.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await act(async () => {
      expect(await m.vm.actions.restart()).toBe(false);
    });
    expect(pond.adminRestart.mock.calls).toEqual([[false]]);
    expect(m.vm.gate.restarting).toBe(false);
    expect(m.vm.gate.phase).not.toBe('locked');
    await m.unmount();
  });

  it('sends nothing when the first question is declined', async () => {
    pond.adminStatus.mockResolvedValue(OPEN);
    const m = await mount(usePondPower);
    mockAsk.mockResolvedValueOnce(false);
    await act(async () => {
      await m.vm.actions.restart();
    });
    expect(pond.adminRestart).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('asks before switching mode, and offers a restart when the mode waits for one', async () => {
    pond.adminStatus.mockResolvedValue(OPEN);
    pond.adminSetPowerMode.mockResolvedValue({ mode: { id: 0, name: '15W' }, reboot_required: true });
    const m = await mount(usePondPower);
    mockAsk.mockResolvedValueOnce(false);
    await act(async () => {
      await m.vm.actions.choose({ id: 0, name: '15W' });
    });
    expect(pond.adminSetPowerMode).not.toHaveBeenCalled();
    mockAsk.mockResolvedValueOnce(true);
    await act(async () => {
      expect(await m.vm.actions.choose({ id: 0, name: '15W' })).toBe(true);
    });
    expect(pond.adminSetPowerMode).toHaveBeenCalledWith(0);
    expect(m.vm.power?.mode).toEqual({ id: 0, name: '15W' });
    expect(m.vm.rebootRequired).toBe(true);
    await m.unmount();
  });

  it('shows modes as fixed on a Pond that cannot change them', async () => {
    pond.adminStatus.mockResolvedValue(OPEN);
    pond.adminPower.mockResolvedValue({ ...POWER, can_change: false });
    const m = await mount(usePondPower);
    expect(m.vm.fixed).toBe(true);
    await act(async () => {
      expect(await m.vm.actions.choose({ id: 0, name: '15W' })).toBe(false);
    });
    expect(mockAsk).not.toHaveBeenCalled();
    await m.unmount();
  });
});

describe('on the mock Pond', () => {
  it('unlocks with the mock card and reads its overview, with no request reaching a Pond', async () => {
    server.real = false;
    const m = await mount(() => ({ tab: useMyPond(), form: useAdminUnlock() }));
    expect(m.vm.tab.gate.phase).toBe('locked');
    await act(async () => m.vm.form.setPassword(MOCK_ADMIN_PASSWORD));
    await act(async () => {
      await m.vm.form.unlock();
    });
    await flush();
    expect(m.vm.tab.gate.phase).toBe('unlocked');
    expect(m.vm.tab.overview?.counts.sessions).toBe(128);
    expect(m.vm.tab.healthWarning).toBe(true);
    expect(pond.adminStatus).not.toHaveBeenCalled();
    expect(pond.adminUnlock).not.toHaveBeenCalled();
    await m.unmount();
  });
});
