// The mock Pond has to answer as the contract says the real one will, or the screens built against
// it are built against the wrong thing. Its clock is moved by hand.

import { ApiError } from '@/services/api-client';
import {
  createMockPond,
  MOCK_ADMIN_PASSWORD,
  MOCK_FIRST_WAIT_SECS,
  MOCK_FREE_ATTEMPTS,
  type PondAdminSource,
} from '@/models/pond-admin-mock';

const MINUTE = 60_000;

function clock() {
  let t = Date.parse('2026-10-29T08:00:00Z');
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

async function refusal(p: Promise<unknown>): Promise<{ status: number; error: string | null; body: unknown; retry: number | null }> {
  const e = await p.then(
    () => {
      throw new Error('expected a refusal');
    },
    (err: unknown) => err,
  );
  if (!(e instanceof ApiError)) throw e;
  return { status: e.status, error: e.detail, body: e.body, retry: e.retryAfterSecs };
}

async function unlocked(): Promise<{ pond: PondAdminSource; time: ReturnType<typeof clock> }> {
  const time = clock();
  const pond = createMockPond({}, time.now);
  await pond.unlock(MOCK_ADMIN_PASSWORD);
  return { pond, time };
}

describe('the lock', () => {
  it('starts locked, refuses every admin route, and opens with the card', async () => {
    const time = clock();
    const pond = createMockPond({}, time.now);
    expect(await pond.status()).toEqual({ card: 'present', unlocked: false, expires_at: null, idle_minutes: 15, retry_after: null, key: false, keys: true });
    expect(await refusal(pond.overview())).toMatchObject({ status: 403, error: 'admin_locked' });
    expect(await refusal(pond.files(''))).toMatchObject({ status: 403, error: 'admin_locked' });

    const answer = await pond.unlock('goos eina pond 2026');
    expect(answer).toEqual({ unlocked: true, expires_at: '2026-10-29T08:15:00.000Z' });
    expect((await pond.status()).unlocked).toBe(true);
    await expect(pond.overview()).resolves.toBeTruthy();
  });

  it('locks after 15 idle minutes; each admin request renews it and reading the status does not', async () => {
    const { pond, time } = await unlocked();
    time.advance(10 * MINUTE);
    await pond.caches();
    time.advance(14 * MINUTE);
    // Twenty-four minutes after the unlock, but fourteen after the last request.
    expect(await pond.status()).toMatchObject({ unlocked: true, expires_at: '2026-10-29T08:25:00.000Z' });
    time.advance(MINUTE);
    expect((await pond.status()).unlocked).toBe(false);
    expect(await refusal(pond.health())).toMatchObject({ status: 403, error: 'admin_locked' });
  });

  it('locks when asked', async () => {
    const { pond } = await unlocked();
    await pond.lock();
    expect((await pond.status()).unlocked).toBe(false);
  });

  it('refuses a wrong card, a malformed one, and slows guesses after five, doubling the wait', async () => {
    const time = clock();
    const pond = createMockPond({}, time.now);
    expect(await refusal(pond.unlock('G00S'))).toMatchObject({ status: 400, error: 'admin_password_malformed' });
    for (let i = 1; i < MOCK_FREE_ATTEMPTS; i++) {
      expect(await refusal(pond.unlock('AAAA-AAAA-AAAA-AAAA'))).toMatchObject({ status: 403, error: 'admin_password_rejected' });
    }
    expect((await pond.status()).retry_after).toBeNull();
    expect(await refusal(pond.unlock('AAAA-AAAA-AAAA-AAAA'))).toMatchObject({ status: 403, error: 'admin_password_rejected' });
    expect((await pond.status()).retry_after).toBe(MOCK_FIRST_WAIT_SECS);

    // Even the right card is not heard while it cools.
    time.advance(10_000);
    expect(await refusal(pond.unlock(MOCK_ADMIN_PASSWORD))).toEqual({
      status: 429,
      error: 'admin_cooling',
      body: { error: 'admin_cooling', retry_after: 20 },
      retry: 20,
    });

    time.advance(20_000);
    expect(await refusal(pond.unlock('AAAA-AAAA-AAAA-AAAA'))).toMatchObject({ error: 'admin_password_rejected' });
    expect((await pond.status()).retry_after).toBe(2 * MOCK_FIRST_WAIT_SECS);

    time.advance(2 * MOCK_FIRST_WAIT_SECS * 1000);
    await expect(pond.unlock(MOCK_ADMIN_PASSWORD)).resolves.toMatchObject({ unlocked: true });
    expect((await pond.status()).retry_after).toBeNull();
  });

  it('says when no card was made, and refuses to unlock', async () => {
    const pond = createMockPond({ card: 'missing' });
    expect((await pond.status()).card).toBe('missing');
    expect(await refusal(pond.unlock(MOCK_ADMIN_PASSWORD))).toMatchObject({ status: 409, error: 'admin_card_missing' });
  });

  it('refuses a guest phone on every route, the status included', async () => {
    const pond = createMockPond({ member: false });
    expect(await refusal(pond.status())).toMatchObject({ status: 403, error: 'admin_members_only' });
    expect(await refusal(pond.unlock(MOCK_ADMIN_PASSWORD))).toMatchObject({ status: 403, error: 'admin_members_only' });
    expect(await refusal(pond.lock())).toMatchObject({ status: 403, error: 'admin_members_only' });
  });
});

describe('this phone’s key', () => {
  it('enrolls only while unlocked, and says it holds a key', async () => {
    const pond = createMockPond({}, clock().now);
    expect(await refusal(pond.enroll())).toMatchObject({ status: 403, error: 'admin_locked' });
    await pond.unlock(MOCK_ADMIN_PASSWORD);
    const key = await pond.enroll();
    expect(typeof key).toBe('string');
    expect((await pond.status()).key).toBe(true);
  });

  it('opens with the key once locked again, and needs no card to', async () => {
    const { pond } = await unlocked();
    const key = await pond.enroll();
    await pond.lock();
    await expect(pond.unlockWithKey(key)).resolves.toMatchObject({ unlocked: true });
    expect((await pond.status()).unlocked).toBe(true);
  });

  it('rejects a key it replaced, and one it revoked, and locks on revoking', async () => {
    const { pond } = await unlocked();
    const first = await pond.enroll();
    const second = await pond.enroll();
    expect(second).not.toBe(first);
    await pond.lock();
    expect(await refusal(pond.unlockWithKey(first))).toMatchObject({ status: 403, error: 'admin_key_rejected' });
    await pond.unlockWithKey(second);

    await pond.forgetKey();
    expect(await pond.status()).toMatchObject({ unlocked: false, key: false });
    expect(await refusal(pond.unlockWithKey(second))).toMatchObject({ status: 403, error: 'admin_key_rejected' });
  });

  it('counts a wrong key toward the same slowing as a wrong card', async () => {
    const pond = createMockPond({}, clock().now);
    for (let i = 1; i < MOCK_FREE_ATTEMPTS; i++) await refusal(pond.unlock('AAAA-AAAA-AAAA-AAAA'));
    expect((await pond.status()).retry_after).toBeNull();
    expect(await refusal(pond.unlockWithKey('not-a-key'))).toMatchObject({ error: 'admin_key_rejected' });
    expect((await pond.status()).retry_after).toBe(MOCK_FIRST_WAIT_SECS);
    expect(await refusal(pond.unlockWithKey('not-a-key'))).toMatchObject({ status: 429, error: 'admin_cooling' });
  });

  it('opens to the key setup gave on a Pond whose card was never made', async () => {
    const pond = createMockPond({ card: 'missing', key: 'setup-key' }, clock().now);
    expect(await pond.status()).toMatchObject({ card: 'missing', key: true });
    expect(await refusal(pond.unlock(MOCK_ADMIN_PASSWORD))).toMatchObject({ status: 409, error: 'admin_card_missing' });
    expect(await refusal(pond.unlockWithKey('anything'))).toMatchObject({ status: 403, error: 'admin_key_rejected' });
    await expect(pond.unlockWithKey('setup-key')).resolves.toMatchObject({ unlocked: true });
  });

  it('refuses a guest phone the key routes too', async () => {
    const pond = createMockPond({ member: false });
    expect(await refusal(pond.unlockWithKey('k'))).toMatchObject({ status: 403, error: 'admin_members_only' });
    expect(await refusal(pond.enroll())).toMatchObject({ status: 403, error: 'admin_members_only' });
    expect(await refusal(pond.forgetKey())).toMatchObject({ status: 403, error: 'admin_members_only' });
  });
});

describe('files', () => {
  it('lists the data folder largest first, keeping the databases and models', async () => {
    const { pond } = await unlocked();
    const root = await pond.files('');
    const bytes = root.entries.map((e) => e.bytes);
    expect(bytes).toEqual([...bytes].sort((a, b) => b - a));
    const byName = Object.fromEntries(root.entries.map((e) => [e.name, e]));
    expect(byName['pond_system.db']).toMatchObject({ deletable: false, reason: 'in_use' });
    expect(byName.models).toMatchObject({ kind: 'directory', deletable: false, reason: 'managed_by_models' });
    // A folder holding something in use is kept too.
    expect(byName.engine).toMatchObject({ deletable: false, reason: 'in_use' });
    expect(byName['pond-snapshot-2026-09-30.tar.gz']).toMatchObject({ deletable: true, reason: null });
    expect((await pond.files('models')).entries.every((e) => e.reason === 'managed_by_models')).toBe(true);
  });

  it('refuses paths outside the data folder, ones that are not there, and files as folders', async () => {
    const { pond } = await unlocked();
    expect(await refusal(pond.files('../etc'))).toMatchObject({ status: 400, error: 'invalid_path' });
    expect(await refusal(pond.files('/etc'))).toMatchObject({ status: 400, error: 'invalid_path' });
    expect(await refusal(pond.files('nowhere'))).toMatchObject({ status: 404, error: 'not_found' });
    expect(await refusal(pond.files('pond_system.db'))).toMatchObject({ status: 409, error: 'not_a_directory' });
  });

  it('deletes what may go, freeing its space on the disk and in the overview', async () => {
    const { pond } = await unlocked();
    const before = await pond.overview();
    const freed = await pond.deleteFile('logs/pond.log.2026-10-27');
    expect(freed).toBe(71 * 1024 * 1024);
    const after = await pond.overview();
    expect(after.disk.free_bytes - before.disk.free_bytes).toBe(freed);
    expect((await pond.files('logs')).entries.map((e) => e.name)).not.toContain('pond.log.2026-10-27');
    expect(await refusal(pond.deleteFile('logs/pond.log.2026-10-27'))).toMatchObject({ status: 404, error: 'not_found' });
  });

  it('refuses to delete what the Pond keeps, saying why', async () => {
    const { pond } = await unlocked();
    expect(await refusal(pond.deleteFile('pond_system.db'))).toMatchObject({ status: 403, error: 'protected_path', body: { reason: 'in_use' } });
    expect(await refusal(pond.deleteFile('models/kokoro-v1.0.onnx'))).toMatchObject({ status: 403, body: { reason: 'managed_by_models' } });
    expect(await refusal(pond.deleteFile(''))).toMatchObject({ status: 400, error: 'invalid_path' });
  });
});

describe('caches', () => {
  it('clears one, freeing what it said it held, and mends the disk check', async () => {
    const { pond } = await unlocked();
    expect((await pond.health()).checks.find((c) => c.id === 'disk_space')?.status).toBe('warning');
    const caches = await pond.caches();
    expect(caches.map((c) => c.id)).toEqual(['kv_snapshots', 'download_leftovers', 'accelerator_caches']);
    let freed = 0;
    for (const cache of caches) freed += await pond.clearCache(cache.id);
    expect(freed).toBe(caches.reduce((sum, c) => sum + c.bytes, 0));
    expect((await pond.caches()).every((c) => c.bytes === 0 && c.files === 0)).toBe(true);
    expect((await pond.health()).checks.find((c) => c.id === 'disk_space')?.status).toBe('ok');
    // The long tasks' suspended states are not the cache's to clear.
    expect((await pond.files('engine/kv/suspended')).entries).toHaveLength(1);
  });

  it('refuses a cache it does not have', async () => {
    const { pond } = await unlocked();
    expect(await refusal(pond.clearCache('mystery' as never))).toMatchObject({ status: 404, error: 'unknown_cache' });
  });
});

describe('tasks', () => {
  it('hides another member goal and titles', async () => {
    const { pond } = await unlocked();
    const theirs = (await pond.tasks()).find((t) => t.another_member);
    expect(theirs?.goal).toBeNull();
    expect(theirs?.artifacts.every((a) => a.title === null)).toBe(true);
  });

  it('deletes a finished task or one artifact of it, and refuses an active one', async () => {
    const { pond } = await unlocked();
    expect(await refusal(pond.deleteTask('lt-3n7p0x2c'))).toMatchObject({ status: 409, error: 'task_active' });
    expect(await refusal(pond.deleteTaskArtifact('lt-3n7p0x2c', 'ar-3n7p-plan'))).toMatchObject({ status: 409, error: 'task_active' });

    await pond.deleteTaskArtifact('lt-8f2k1m9q', 'ar-8f2k-see');
    expect((await pond.tasks()).find((t) => t.id === 'lt-8f2k1m9q')?.artifacts.map((a) => a.id)).not.toContain('ar-8f2k-see');
    await pond.deleteTask('lt-q4w8e1r5');
    expect((await pond.tasks()).map((t) => t.id)).not.toContain('lt-q4w8e1r5');
    expect(await refusal(pond.deleteTask('lt-q4w8e1r5'))).toMatchObject({ status: 404, error: 'not_found' });
  });
});

describe('power', () => {
  it('switches modes, saying when one waits for a restart', async () => {
    const { pond } = await unlocked();
    expect((await pond.power()).mode).toEqual({ id: 1, name: '25W' });
    expect(await pond.setPowerMode(0)).toEqual({ mode: { id: 0, name: '15W' }, reboot_required: false });
    expect(await pond.setPowerMode(3)).toEqual({ mode: { id: 3, name: '7W' }, reboot_required: true });
    expect(await refusal(pond.setPowerMode(9))).toMatchObject({ status: 400, error: 'unknown_power_mode' });
  });

  it('will not restart under a running long task unless forced, and a restart locks', async () => {
    const { pond } = await unlocked();
    expect(await refusal(pond.restart(false))).toMatchObject({ status: 409, error: 'long_task_running' });
    expect((await pond.status()).unlocked).toBe(true);
    await pond.restart(true);
    expect((await pond.status()).unlocked).toBe(false);
  });

  it('cannot change anything on a board without power control', async () => {
    const time = clock();
    const pond = createMockPond({ powerControl: false }, time.now);
    await pond.unlock(MOCK_ADMIN_PASSWORD);
    expect(await pond.power()).toMatchObject({ control: 'none', can_change: false, mode: null, modes: [] });
    expect(await refusal(pond.setPowerMode(1))).toMatchObject({ status: 503, error: 'power_control_unavailable' });
    expect(await refusal(pond.restart(true))).toMatchObject({ status: 503, error: 'power_control_unavailable' });
  });
});
