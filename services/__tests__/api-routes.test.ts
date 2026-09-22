jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
/**
 * The route wrappers, and the three things in `request()` every one of them
 * inherits: envelope unwrapping, empty-body tolerance, and one shared refresh.
 *
 * These assert transport behaviour rather than route spelling. A wrapper that
 * compiles proves nothing about whether the server agrees with it — that needs a
 * live Pond, and is listed in the PR. What is worth pinning here is the handling
 * that would otherwise be wrong identically in thirty methods.
 */

import { PondApiClient } from '@/services/api-client';

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

function setFetch(impl: unknown) {
  Object.defineProperty(globalThis, 'fetch', { value: impl, configurable: true, writable: true });
}

/** A `Response` stand-in carrying only what `request()` reads. */
function reply(body: string, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else delete (globalThis as { fetch?: unknown }).fetch;
});

describe('envelope unwrapping', () => {
  /**
   * `GET /devices` answers `{devices: [...]}`. The desktop client unwraps it, and
   * a wrapper that returned the envelope would make every caller do it again.
   */
  it('returns the list from an enveloped collection', async () => {
    setFetch(async () => reply('{"devices":[{"id":"d1","name":"Lamp","is_online":true}]}'));
    const api = new PondApiClient('https://pond.test:4000');

    await expect(api.listDevices()).resolves.toEqual([
      { id: 'd1', name: 'Lamp', is_online: true },
    ]);
  });

  /** Older ponds answer a bare array. Both shapes have to work. */
  it('returns the list when the server sends a bare array', async () => {
    setFetch(async () => reply('[{"id":"d1","name":"Lamp","is_online":true}]'));
    const api = new PondApiClient('https://pond.test:4000');

    await expect(api.listDevices()).resolves.toHaveLength(1);
  });
});

describe('empty bodies', () => {
  /**
   * DELETE answers 204. `res.json()` throws on an empty body, so without this
   * every successful delete would surface as a parse error.
   */
  it('resolves a 204 instead of failing to parse it', async () => {
    setFetch(async () => reply('', { status: 204 }));
    const api = new PondApiClient('https://pond.test:4000');

    await expect(api.deleteDevice('d1')).resolves.toBeUndefined();
  });

  it('resolves a 200 that carries no body', async () => {
    setFetch(async () => reply(''));
    const api = new PondApiClient('https://pond.test:4000');

    await expect(api.pauseSchedule('s1')).resolves.toBeUndefined();
  });
});

describe('concurrent 401s', () => {
  /**
   * Refresh tokens rotate, so a second refresh presents one the server has
   * already retired. Firing several would turn a recoverable expiry into a
   * forced re-pair — the first succeeds and the rest invalidate the session.
   */
  it('shares one refresh across requests that 401 together', async () => {
    let refreshes = 0;
    let refreshed = false;

    setFetch(async (url: string) => {
      if (url.endsWith('/handshake/refresh')) {
        refreshes++;
        // Resolve on a later tick so the other callers reach their own 401
        // first. If they each start a refresh, this counter climbs.
        await new Promise((r) => setTimeout(r, 0));
        refreshed = true;
        return reply('{"accepted":true,"session_token":"new","refresh_token":"r2"}');
      }
      // Every request rejects the stale token, which is the real situation:
      // three screens firing at once after a 24h session expiry.
      if (!refreshed) return reply('', { status: 401 });
      return reply('{"devices":[]}');
    });

    const api = new PondApiClient('https://pond.test:4000');
    api.setToken('stale');
    api.setRefreshToken('refresh-1');

    await Promise.all([
      api.listDevices().catch(() => undefined),
      api.listSessions().catch(() => undefined),
      api.listSchedules().catch(() => undefined),
    ]);

    expect(refreshes).toBe(1);
  });
});

/**
 * Who this phone belongs to comes from the Pond, which reads it off the token it issued at
 * pairing. The phone never says who it is; it asks. Pinned so the wrapper cannot drift onto a
 * path that takes the device id from the client.
 */
it('asks the Pond which member this device belongs to, naming no device itself', async () => {
  const seen: { url: string; method?: string }[] = [];
  setFetch(async (url: string, init?: { method?: string }) => {
    seen.push({ url, method: init?.method });
    return reply('{"device_id":"install-77","profile":{"id":"p1","display_name":"Liz"}}');
  });
  const api = new PondApiClient('https://pond.test:4000');

  await expect(api.deviceSelf()).resolves.toEqual({
    device_id: 'install-77',
    profile: { id: 'p1', display_name: 'Liz' },
  });
  expect(seen).toEqual([{ url: 'https://pond.test:4000/api/v1/devices/self', method: undefined }]);
});

it('reads which Pond this is from its own system info', async () => {
  const seen: string[] = [];
  setFetch(async (url: string) => { seen.push(url); return reply('{"hostname":"giap-mac","version":"0.1.0"}'); });
  const api = new PondApiClient('https://pond.test:4000');

  await expect(api.systemInfo()).resolves.toMatchObject({ hostname: 'giap-mac' });
  expect(seen).toEqual(['https://pond.test:4000/api/v1/system/info']);
});

describe('right-now reads', () => {
  it('reads the weather the Pond reports, which is in Celsius', async () => {
    const seen: string[] = [];
    setFetch(async (url: string) => { seen.push(url); return reply('{"enabled":true,"temp":22,"location_name":"Nairobi"}'); });
    const api = new PondApiClient('https://pond.test:4000');

    await expect(api.weather()).resolves.toMatchObject({ enabled: true, temp: 22 });
    expect(seen).toEqual(['https://pond.test:4000/api/v1/weather']);
  });

  it('reads what is playing', async () => {
    const seen: string[] = [];
    setFetch(async (url: string) => { seen.push(url); return reply('{"connected":true,"playing":false}'); });
    const api = new PondApiClient('https://pond.test:4000');

    await expect(api.nowPlaying()).resolves.toEqual({ connected: true, playing: false });
    expect(seen).toEqual(['https://pond.test:4000/api/v1/music/now-playing']);
  });

  // The Pond answers `json!(tasks)`: a bare array of its own Schedule, which has `label` and
  // `paused` and no `name` or `enabled`. Read it as what it is.
  it('reads the next routines as the bare array the Pond sends', async () => {
    const seen: string[] = [];
    setFetch(async (url: string) => {
      seen.push(url);
      return reply('[{"id":"s1","label":"Morning briefing","next_run":"2026-09-23T04:00:00Z","paused":false}]');
    });
    const api = new PondApiClient('https://pond.test:4000');

    await expect(api.upcomingSchedules(1)).resolves.toEqual([
      { id: 's1', label: 'Morning briefing', next_run: '2026-09-23T04:00:00Z', paused: false },
    ]);
    expect(seen).toEqual(['https://pond.test:4000/api/v1/schedules/upcoming?limit=1']);
  });
});
