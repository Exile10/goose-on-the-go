// My Pond's routes as goose-in-a-pond's pond-administrator.md gives them: each method and path, the
// path query encoded, the bodies, the bearer, and a body of the wrong shape refused rather than read.

import { ApiError, PondApiClient } from '@/services/api-client';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

function setFetch(impl: unknown) {
  Object.defineProperty(globalThis, 'fetch', { value: impl, configurable: true, writable: true });
}

function reply(body: string, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

interface Seen {
  url: string;
  method?: string;
  body?: unknown;
  authorization: string | null;
}

function recordInto(seen: Seen[], body: string, status = 200, headers: Record<string, string> = {}) {
  setFetch(async (url: string, init?: { method?: string; body?: string; headers?: Headers }) => {
    seen.push({
      url,
      method: init?.method,
      body: init?.body ? JSON.parse(init.body) : undefined,
      authorization: init?.headers?.get('Authorization') ?? null,
    });
    return reply(body, status, headers);
  });
}

afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else delete (globalThis as { fetch?: unknown }).fetch;
});

function paired() {
  const client = new PondApiClient('https://pond.test:4000');
  client.setToken('session-token');
  return client;
}

const BASE = 'https://pond.test:4000/api/v1/admin';

describe('the lock', () => {
  it('reads the status with the bearer', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"card":"present","unlocked":true,"expires_at":"2026-10-29T10:15:00Z","idle_minutes":15,"retry_after":null}');
    const status = await paired().adminStatus();
    expect(seen).toEqual([{ url: `${BASE}/status`, method: undefined, body: undefined, authorization: 'Bearer session-token' }]);
    expect(status).toEqual({ card: 'present', unlocked: true, expires_at: '2026-10-29T10:15:00Z', idle_minutes: 15, retry_after: null, key: false });
  });

  it('unlocks with the password as the body, and locks with an empty one', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"unlocked":true,"expires_at":"2026-10-29T10:15:00Z"}');
    const client = paired();
    expect(await client.adminUnlock('G00SE1NAP0ND2026')).toEqual({ unlocked: true, expires_at: '2026-10-29T10:15:00Z' });
    recordInto(seen, '', 204);
    await client.adminLock();
    expect(seen.map((s) => [s.method, s.url, s.body, s.authorization])).toEqual([
      ['POST', `${BASE}/unlock`, { password: 'G00SE1NAP0ND2026' }, 'Bearer session-token'],
      ['POST', `${BASE}/lock`, {}, 'Bearer session-token'],
    ]);
  });

  it('hands the caller the refusal code and the wait from a cooling Pond', async () => {
    recordInto([], '{"error":"admin_cooling","retry_after":60}', 429, { 'retry-after': '60' });
    const refused = await paired().adminUnlock('XXXXXXXXXXXXXXXX').catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status: 429, detail: 'admin_cooling', retryAfterSecs: 60, body: { retry_after: 60 } });
  });

  it('refuses a status that is not one', async () => {
    recordInto([], '"nope"');
    await expect(paired().adminStatus()).rejects.toThrow('unexpected');
  });
});

describe('this phone’s key', () => {
  it('reads whether the Pond holds one, and reads a missing field as none', async () => {
    recordInto([], '{"card":"present","unlocked":false,"key":true}');
    expect((await paired().adminStatus()).key).toBe(true);
    recordInto([], '{"card":"present","unlocked":false}');
    expect((await paired().adminStatus()).key).toBe(false);
  });

  it('unlocks with the key as the body, on the same route as the card', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"unlocked":true,"expires_at":"2026-10-29T10:15:00Z"}');
    expect(await paired().adminUnlockWithKey('key-1')).toEqual({ unlocked: true, expires_at: '2026-10-29T10:15:00Z' });
    expect(seen).toEqual([{ url: `${BASE}/unlock`, method: 'POST', body: { key: 'key-1' }, authorization: 'Bearer session-token' }]);
  });

  it('hands the caller a rejected key', async () => {
    recordInto([], '{"error":"admin_key_rejected"}', 403);
    await expect(paired().adminUnlockWithKey('old-key')).rejects.toMatchObject({ status: 403, detail: 'admin_key_rejected' });
  });

  it('enrolls with an empty body and reads the key it gives', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"key":"key-2"}');
    expect(await paired().adminEnroll()).toBe('key-2');
    expect(seen).toEqual([{ url: `${BASE}/enroll`, method: 'POST', body: {}, authorization: 'Bearer session-token' }]);
  });

  it('refuses an enrolment answer with no key, without repeating the answer', async () => {
    recordInto([], '{"key":""}');
    const e = await paired().adminEnroll().catch((err: unknown) => err);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toMatch('unexpected');
  });

  it('forgets the key with a DELETE and no body', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '', 204);
    await paired().adminForgetKey();
    expect(seen).toEqual([{ url: `${BASE}/key`, method: 'DELETE', body: undefined, authorization: 'Bearer session-token' }]);
  });
});

describe('what the Pond holds', () => {
  it('reads the overview', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"disk":{"total_bytes":100,"free_bytes":40},"data_dir_bytes":30,"areas":[],"databases":[],"counts":{}}');
    const overview = await paired().adminOverview();
    expect(seen[0]).toMatchObject({ url: `${BASE}/overview`, method: undefined, authorization: 'Bearer session-token' });
    expect(overview.disk).toEqual({ total_bytes: 100, free_bytes: 40 });
  });

  it('lists a folder with its path encoded in the query, the root as an empty path', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"path":"","entries":[]}');
    const client = paired();
    await client.adminFiles('');
    await client.adminFiles('engine/kv cache/a&b=c#1');
    expect(seen.map((s) => s.url)).toEqual([
      `${BASE}/files?path=`,
      `${BASE}/files?path=engine%2Fkv%20cache%2Fa%26b%3Dc%231`,
    ]);
  });

  it('deletes a path in the query and reads what it freed', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"freed_bytes":4096}');
    expect(await paired().adminDeleteFile('logs/pond.log.2026-10-27')).toBe(4096);
    expect(seen[0]).toMatchObject({
      method: 'DELETE',
      url: `${BASE}/files?path=logs%2Fpond.log.2026-10-27`,
      body: undefined,
      authorization: 'Bearer session-token',
    });
  });

  it('passes a protected path refusal through with its reason', async () => {
    recordInto([], '{"error":"protected_path","reason":"in_use"}', 403);
    await expect(paired().adminDeleteFile('pond_system.db')).rejects.toMatchObject({
      status: 403,
      detail: 'protected_path',
      body: { reason: 'in_use' },
    });
  });
});

describe('caches', () => {
  it('lists and clears by id', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"caches":[{"id":"kv_snapshots","bytes":10,"files":2}]}');
    const client = paired();
    expect(await client.adminCaches()).toEqual([{ id: 'kv_snapshots', bytes: 10, files: 2 }]);
    recordInto(seen, '{"freed_bytes":10}');
    expect(await client.adminClearCache('kv_snapshots')).toBe(10);
    expect(seen.map((s) => [s.method, s.url, s.body])).toEqual([
      [undefined, `${BASE}/caches`, undefined],
      ['POST', `${BASE}/caches/kv_snapshots/clear`, {}],
    ]);
  });
});

describe('tasks', () => {
  it('lists, and deletes a task or one artifact with each id as one encoded segment', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"tasks":[]}');
    const client = paired();
    expect(await client.adminTasks()).toEqual([]);
    recordInto(seen, '{"deleted":true}');
    await client.adminDeleteTask('lt 1/2');
    await client.adminDeleteTaskArtifact('lt 1/2', 'ar?3');
    expect(seen.map((s) => [s.method, s.url, s.authorization])).toEqual([
      [undefined, `${BASE}/tasks`, 'Bearer session-token'],
      ['DELETE', `${BASE}/tasks/lt%201%2F2`, 'Bearer session-token'],
      ['DELETE', `${BASE}/tasks/lt%201%2F2/artifacts/ar%3F3`, 'Bearer session-token'],
    ]);
  });

  it('reaches the caller with task_active', async () => {
    recordInto([], '{"error":"task_active"}', 409);
    await expect(paired().adminDeleteTask('lt-1')).rejects.toMatchObject({ status: 409, detail: 'task_active' });
  });
});

describe('health and power', () => {
  it('reads health and power', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"version":"1","host":{},"checks":[]}');
    const client = paired();
    expect((await client.adminHealth()).version).toBe('1');
    recordInto(seen, '{"control":"nvpmodel","mode":{"id":1,"name":"25W"},"modes":[],"can_change":true}');
    expect((await client.adminPower()).mode).toEqual({ id: 1, name: '25W' });
    expect(seen.map((s) => s.url)).toEqual([`${BASE}/health`, `${BASE}/power`]);
  });

  it('sets a mode by id', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"mode":{"id":3,"name":"7W"},"reboot_required":true}');
    expect(await paired().adminSetPowerMode(3)).toEqual({ mode: { id: 3, name: '7W' }, reboot_required: true });
    expect(seen[0]).toMatchObject({ method: 'PUT', url: `${BASE}/power/mode`, body: { id: 3 }, authorization: 'Bearer session-token' });
  });

  it('restarts with an empty body, and sends force only when asked to', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"restarting":true}', 202);
    const client = paired();
    await client.adminRestart(false);
    await client.adminRestart(true);
    expect(seen.map((s) => [s.method, s.url, s.body])).toEqual([
      ['POST', `${BASE}/power/restart`, {}],
      ['POST', `${BASE}/power/restart`, { force: true }],
    ]);
  });

  it('reaches the caller with long_task_running', async () => {
    recordInto([], '{"error":"long_task_running"}', 409);
    await expect(paired().adminRestart(false)).rejects.toMatchObject({ status: 409, detail: 'long_task_running' });
  });
});
