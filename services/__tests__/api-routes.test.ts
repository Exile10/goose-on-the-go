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

describe('pending notifications', () => {
  /** The contract allows either shape; the wake-up must not care which one the Pond sends. */
  it('reads the list bare or wrapped, and acknowledges by id', async () => {
    const calls: string[] = [];
    const bodies = ['[{"id":"a"}]', '{"notifications":[{"id":"b"}]}', ''];
    setFetch(async (url: string, init: { method?: string }) => {
      calls.push(`${init.method ?? 'GET'} ${url}`);
      return reply(bodies.shift() ?? '');
    });
    const api = new PondApiClient('https://pond.test:4000');

    await expect(api.pendingNotifications()).resolves.toEqual([{ id: 'a' }]);
    await expect(api.pendingNotifications()).resolves.toEqual([{ id: 'b' }]);
    await expect(api.ackNotification('n/1')).resolves.toBeUndefined();
    expect(calls).toEqual([
      'GET https://pond.test:4000/api/v1/notifications/pending',
      'GET https://pond.test:4000/api/v1/notifications/pending',
      'POST https://pond.test:4000/api/v1/notifications/n%2F1/ack',
    ]);
  });
});

describe('conversations by where they were begun', () => {
  it('asks for every conversation, or only those begun on the surfaces named', async () => {
    const calls: string[] = [];
    setFetch(async (url: string) => {
      calls.push(url);
      return reply('{"sessions":[{"id":"goose-m1","surface":"goose"}]}');
    });
    const api = new PondApiClient('https://pond.test:4000');

    await api.listSessions();
    await expect(api.listSessions(['phone', 'goose'])).resolves.toEqual([{ id: 'goose-m1', surface: 'goose' }]);
    await api.listSessions(['desktop', 'cli', 'pond', 'unknown']);

    expect(calls).toEqual([
      'https://pond.test:4000/api/v1/sessions',
      'https://pond.test:4000/api/v1/sessions?surface=phone,goose',
      'https://pond.test:4000/api/v1/sessions?surface=desktop,cli,pond,unknown',
    ]);
  });

  it('answers an offer on the message that made it', async () => {
    const seen: { url: string; method?: string; body?: string }[] = [];
    setFetch(async (url: string, init: { method?: string; body?: string }) => {
      seen.push({ url, method: init.method, body: init.body });
      return reply('{"state":"done","prompt":"Remind me on Thursday"}');
    });
    const api = new PondApiClient('https://pond.test:4000');

    await expect(api.answerOffer('goose-m1', 'msg/1', true)).resolves.toEqual({ state: 'done', prompt: 'Remind me on Thursday' });

    expect(seen).toEqual([
      { url: 'https://pond.test:4000/api/v1/sessions/goose-m1/messages/msg%2F1/offer', method: 'POST', body: '{"take":true}' },
    ]);
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

/**
 * The Pond derives `is_online` from `last_seen` against a five-minute threshold
 * and has had a heartbeat route with no caller, so a paired phone aged out of its
 * own device list and reported itself offline while in use. The path and method
 * are what this pins; the interval that drives it is a provider concern and is
 * verified against a real Pond rather than here.
 */
it('posts a heartbeat to the device path the Pond registered', async () => {
  const seen: { url: string; method?: string }[] = [];
  setFetch(async (url: string, init?: { method?: string }) => {
    seen.push({ url, method: init?.method });
    return reply('{"status":"ok"}');
  });
  const api = new PondApiClient('https://pond.test:4000');

  await api.deviceHeartbeat('install-77');

  expect(seen).toHaveLength(1);
  expect(seen[0].method).toBe('POST');
  expect(seen[0].url).toBe('https://pond.test:4000/api/v1/devices/install-77/heartbeat');
});

it('escapes a device id that would otherwise change the path', async () => {
  const seen: string[] = [];
  setFetch(async (url: string) => { seen.push(url); return reply('{}'); });
  const api = new PondApiClient('https://pond.test:4000');

  await api.deviceHeartbeat('a/../b');

  expect(seen[0]).toBe('https://pond.test:4000/api/v1/devices/a%2F..%2Fb/heartbeat');
});

/**
 * A response shape the wrapper did not expect must not reach a screen as
 * `undefined`. The Pond answering `{}` -- or an envelope with the key missing or
 * null -- crashed the AI Models screen with "Cannot read property 'find' of
 * undefined", because the declared type asserted a key the body need not carry.
 */
describe('a catalogue the server did not send', () => {
  it.each([
    ['an envelope without the key', '{}'],
    ['an envelope with a null list', '{"models":null}'],
    ['an unrelated envelope', '{"items":[{"name":"x"}]}'],
  ])('answers %s with an empty list rather than undefined', async (_label, body) => {
    setFetch(async () => reply(body));
    const api = new PondApiClient('https://pond.test:4000');
    await expect(api.listModels()).resolves.toEqual([]);
  });

  // The Pond answers six arrays, one per category, never `{models}`; see
  // `listModels`. Each entry comes back tagged with its bucket, and `id` is the
  // `${category}:${name}` pair `/activate` keys on.
  it('still unwraps a well-formed catalogue', async () => {
    setFetch(async () => reply('{"gguf":[{"provider":"p","name":"m","is_active":true}],"ollama":null}'));
    const api = new PondApiClient('https://pond.test:4000');
    await expect(api.listModels()).resolves.toEqual([
      { provider: 'p', name: 'm', is_active: true, category: 'gguf', id: 'gguf:m', pond_category: 'gguf' },
    ]);
  });

  it('keeps the row’s own category, which activation names, beside the bucket it came in', async () => {
    setFetch(async () => reply('{"tts":[{"name":"af_heart","category":"tts_kokoro"}]}'));
    const api = new PondApiClient('https://pond.test:4000');
    await expect(api.listModels()).resolves.toEqual([
      { name: 'af_heart', category: 'tts', pond_category: 'tts_kokoro', id: 'tts:af_heart' },
    ]);
  });

  it('reads the models in use beside the rows, and none from a Pond that lists none', async () => {
    const helper = { id: 'camera_detector', title: 'YOLOX-Nano', uses: ['camera'], section: 'pictures', serves: null };
    setFetch(async () => reply(JSON.stringify({ chat: {}, helpers: [helper] })));
    await expect(new PondApiClient('https://pond.test:4000').helperModels()).resolves.toEqual([helper]);
    setFetch(async () => reply('{"chat":{}}'));
    await expect(new PondApiClient('https://pond.test:4000').helperModels()).resolves.toEqual([]);
  });

  /**
   * Nine wrappers share the unwrapping, so pinning it through one of them proves
   * little. Devices is the other end of the same helper: the Home and Devices
   * screens both map over this list, and `undefined` there fails the same way the
   * models screen did.
   */
  it('applies the same tolerance to the other collections', async () => {
    setFetch(async () => reply('{}'));
    const api = new PondApiClient('https://pond.test:4000');
    await expect(api.listDevices()).resolves.toEqual([]);
    await expect(api.listSchedules()).resolves.toEqual([]);
  });
});

/**
 * A refresh that did not complete is not a refusal. Treating a rate limit or a
 * restarting Pond as one reported the phone revoked -- which ends the session and
 * clears the stored pairing -- while its refresh token was still good.
 */
describe('a refresh that could not complete', () => {
  function expired(refreshStatus: number) {
    setFetch(async (url: string) => {
      if (url.endsWith('/handshake/refresh')) return reply('', { status: refreshStatus });
      return reply('', { status: 401 });
    });
    const api = new PondApiClient('https://pond.test:4000');
    api.setToken('stale');
    api.setRefreshToken('refresh-1');
    const revoked = jest.fn();
    api.setAuthRevoked(revoked);
    return { api, revoked };
  }

  it.each([429, 500, 503])('does not report revocation when the refresh answers %i', async (status) => {
    const { api, revoked } = expired(status);
    await expect(api.listDevices()).rejects.toMatchObject({ status });
    expect(revoked).not.toHaveBeenCalled();
  });

  it('still reports revocation when the Pond refuses the refresh token', async () => {
    const { api, revoked } = expired(401);
    await expect(api.listDevices()).rejects.toMatchObject({ status: 401 });
    expect(revoked).toHaveBeenCalledTimes(1);
  });
});
