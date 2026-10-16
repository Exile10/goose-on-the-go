/**
 * The three web search routes (small-model-tools.md section 8.4).
 *
 * Routes and bodies are checked against that contract; a Pond that serves them is still the real
 * test, and is listed in the PR. What is pinned here is what could be wrong identically on every
 * Pond: the key goes in the body and nowhere else, the paired token goes with all three, and a
 * body that is not the answer is not passed off as one.
 */

import { ApiError, PondApiClient } from '@/services/api-client';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));

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

interface Seen {
  url: string;
  method?: string;
  body?: unknown;
  authorization: string | null;
}

/** Records every request and answers each with `body`. */
function recordInto(seen: Seen[], body: string, status = 200) {
  setFetch(async (url: string, init?: { method?: string; body?: string; headers?: Headers }) => {
    seen.push({
      url,
      method: init?.method,
      body: init?.body ? JSON.parse(init.body) : undefined,
      authorization: init?.headers?.get('Authorization') ?? null,
    });
    return reply(body, { status });
  });
}

afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else delete (globalThis as { fetch?: unknown }).fetch;
});

/** A client that has paired, as every call here needs. */
function paired() {
  const client = new PondApiClient('https://pond.test:4000');
  client.setToken('session-token');
  return client;
}

describe('GET /api/v1/web-search', () => {
  it('asks for the status with the paired token, and returns it', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"provider":"brave","configured":true,"status":"quota"}');

    const state = await paired().webSearchState();

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/web-search');
    expect(seen[0].method).toBeUndefined();
    expect(seen[0].authorization).toBe('Bearer session-token');
    expect(state).toEqual({ provider: 'brave', configured: true, status: 'quota' });
  });

  it('reads no key as not_configured', async () => {
    recordInto([], '{"provider":"brave","configured":false,"status":"not_configured"}');

    await expect(paired().webSearchState()).resolves.toMatchObject({ configured: false, status: 'not_configured' });
  });

  /** `request` casts its body to the declared type, so these would reach the screen as an answer. */
  it.each([
    ['an empty body', ''],
    ['a page from something in front of the Pond', 'null'],
    ['an object with no `configured`', '{"status":"ok"}'],
  ])('refuses %s rather than passing it off as the status', async (_name, body) => {
    recordInto([], body);

    await expect(paired().webSearchState()).rejects.toThrow('unexpected');
  });

  /** An older Pond has no such route. The screen reads the 404 as "not offered yet". */
  it('surfaces a 404 as an ApiError carrying the status', async () => {
    recordInto([], '', 404);

    const failure = await paired().webSearchState().catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(404);
  });
});

describe('PUT /api/v1/web-search/key', () => {
  it('sends the key in the body, once, and nowhere else', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"configured":true,"status":"ok"}');

    const result = await paired().setWebSearchKey('BSA-secret-key');

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/web-search/key');
    expect(seen[0].method).toBe('PUT');
    expect(seen[0].body).toEqual({ key: 'BSA-secret-key' });
    expect(seen[0].authorization).toBe('Bearer session-token');
    // A key in a URL ends up in a log; nothing but the body carries it.
    expect(seen[0].url).not.toContain('BSA-secret-key');
    expect(result).toEqual({ configured: true, status: 'ok' });
  });

  it.each(['ok', 'quota', 'unverified'] as const)('returns the %s the Pond answered with', async (status) => {
    recordInto([], JSON.stringify({ configured: true, status }));

    await expect(paired().setWebSearchKey('k')).resolves.toEqual({ configured: true, status });
  });

  /** A 200 means it is stored. Reading a thin body as a failure would have them paste it again. */
  it('reads a 200 that cannot say how it fared as stored but not yet checked', async () => {
    recordInto([], '');

    await expect(paired().setWebSearchKey('k')).resolves.toEqual({ configured: true, status: 'unverified' });
  });

  it('throws a 422 as an ApiError with the status, and the Pond\'s sentence as detail', async () => {
    recordInto([], '{"error":"Brave did not accept this key."}', 422);

    const failure = await paired().setWebSearchKey('bad').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(422);
    expect((failure as ApiError).detail).toBe('Brave did not accept this key.');
    // The message is for a log, and a log must never hold the key.
    expect((failure as ApiError).message).not.toContain('bad');
  });

  /** A write is not retried through connection recovery: the Pond would check the key twice. */
  it('does not send a second request when the first fails to connect', async () => {
    const seen: Seen[] = [];
    setFetch(async (url: string) => {
      seen.push({ url, authorization: null });
      throw new TypeError('Network request failed');
    });
    const client = paired();
    const recover = jest.fn(async () => 'https://elsewhere.test:4000');
    client.setRecovery(recover);

    await expect(client.setWebSearchKey('k')).rejects.toThrow('Network request failed');

    expect(seen).toHaveLength(1);
    expect(recover).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /api/v1/web-search/key', () => {
  it('removes the key and resolves a 204 instead of failing to parse it', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '', 204);

    await expect(paired().removeWebSearchKey()).resolves.toBeUndefined();

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/web-search/key');
    expect(seen[0].method).toBe('DELETE');
    expect(seen[0].authorization).toBe('Bearer session-token');
  });

  it('throws a refusal rather than reporting the key gone', async () => {
    recordInto([], '', 500);

    await expect(paired().removeWebSearchKey()).rejects.toBeInstanceOf(ApiError);
  });
});
