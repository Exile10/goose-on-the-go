jest.mock('@/services/pond-trust', () => ({
  ...jest.requireActual('@/services/pond-trust'),
  assertPondTrust: jest.fn().mockResolvedValue(undefined),
}));
/**
 * Tests for the API client's error surface.
 *
 * The push-token retry policy makes decisions off `ApiError.status` and
 * `retryAfterSecs`, so parsing them wrongly would silently turn a considerate
 * client back into an inconsiderate one.
 */

import { ApiError, PondApiClient } from '@/services/api-client';

/** A `fetch` returning one canned response. */
function stubFetch(init: { status: number; headers?: Record<string, string>; body?: unknown }) {
  return jest.fn(async () =>
    new Response(JSON.stringify(init.body ?? {}), {
      status: init.status,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    }),
  );
}

/**
 * Swap `fetch` via property descriptors rather than by reading and reassigning
 * it. Expo installs `fetch` as a lazy getter that initializes its native
 * bridge on first read — which cannot work in a Node test environment, and
 * warns during teardown if triggered. Descriptors let us replace it without
 * ever invoking that getter.
 */
const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

function setFetch(impl: unknown) {
  Object.defineProperty(globalThis, 'fetch', {
    value: impl,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (originalFetch) {
    Object.defineProperty(globalThis, 'fetch', originalFetch);
  } else {
    delete (globalThis as { fetch?: unknown }).fetch;
  }
});

describe('ApiError', () => {
  it('treats 429 and 5xx as retryable', () => {
    expect(new ApiError('m', 429, 1).isRetryable).toBe(true);
    expect(new ApiError('m', 500, null).isRetryable).toBe(true);
    expect(new ApiError('m', 503, null).isRetryable).toBe(true);
  });

  /**
   * These describe a request that is wrong, not a moment that is wrong.
   * Retrying an unknown device or a malformed token can never succeed, and on
   * a rate-limited endpoint the attempt itself is the harm.
   */
  it('treats other 4xx as not retryable', () => {
    expect(new ApiError('m', 400, null).isRetryable).toBe(false);
    expect(new ApiError('m', 401, null).isRetryable).toBe(false);
    expect(new ApiError('m', 404, null).isRetryable).toBe(false);
  });

  it('is a real Error, so instanceof and message both work', () => {
    const e = new ApiError('POST /x → 429', 429, 5);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toBe('POST /x → 429');
  });
});

describe('request()', () => {
  it('throws an ApiError carrying the status and Retry-After', async () => {
    setFetch(stubFetch({ status: 429, headers: { 'Retry-After': '42' } }));
    const client = new PondApiClient('https://pond.test');

    const error: ApiError = await client
      .request('/api/v1/thing', { method: 'POST' })
      .then(() => {
        throw new Error('expected the request to reject');
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(429);
    expect(error.retryAfterSecs).toBe(42);
    // Unchanged message format — existing logs stay readable.
    expect(error.message).toBe('POST /api/v1/thing → 429');
  });

  it('reports a null Retry-After when the header is absent', async () => {
    setFetch(stubFetch({ status: 503 }));
    const client = new PondApiClient('https://pond.test');

    const error = (await client.request('/api/v1/thing').catch((e) => e)) as ApiError;

    expect(error.status).toBe(503);
    expect(error.retryAfterSecs).toBeNull();
  });

  /**
   * `Retry-After` also has an HTTP-date form. We only consume delta-seconds,
   * so anything else must read as "no advice" rather than NaN — a NaN would
   * silently poison the backoff arithmetic that depends on it.
   */
  it('ignores a Retry-After it cannot read as seconds', async () => {
    setFetch(stubFetch({
      status: 429,
      headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' },
    }));
    const client = new PondApiClient('https://pond.test');

    const error = (await client.request('/api/v1/thing').catch((e) => e)) as ApiError;

    expect(error.retryAfterSecs).toBeNull();
  });

  it('returns the parsed body on success', async () => {
    setFetch(stubFetch({ status: 200, body: { ok: true } }));
    const client = new PondApiClient('https://pond.test');

    await expect(client.request('/api/v1/thing')).resolves.toEqual({ ok: true });
  });
});


describe('handshakeRevoke()', () => {
  it('retains credentials when durable revocation fails and does not replay the write', async () => {
    const fetch = stubFetch({ status: 503, body: { error: 'revocation_unavailable' } });
    setFetch(fetch);
    const client = new PondApiClient('https://pond.local:4443');
    client.setToken('test-session');
    await expect(client.handshakeRevoke()).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
    setFetch(stubFetch({ status: 200, body: { revoked: true } }));
    await expect(client.handshakeRevoke()).resolves.toBeUndefined();
    const next = stubFetch({ status: 200 });
    setFetch(next);
    await client.handshakeRevoke();
    expect(next).not.toHaveBeenCalled();
  });
  it('requires a positive revocation acknowledgment', async () => {
    setFetch(stubFetch({ status: 200, body: { error: 'not_revoked' } }));
    const client = new PondApiClient('https://pond.local:4443');
    client.setToken('test-session');
    await expect(client.handshakeRevoke()).rejects.toThrow('not acknowledged');
  });
});

describe('local enrollment requests', () => {
  it('keeps the selected LAN endpoint when the shared client roams', async () => {
    const fetch = stubFetch({ status: 200 }); setFetch(fetch);
    const client = new PondApiClient('https://100.64.0.1:4443');
    client.setToken('fixture-session');
    await client.requestLocal('https://192.168.1.2:4443', '/api/v1/remote-access/enrollment', { method: 'POST' });
    expect(fetch).toHaveBeenCalledWith('https://192.168.1.2:4443/api/v1/remote-access/enrollment', expect.objectContaining({ method: 'POST' }));
  });
  it('does not recover, replay or rotate tokens after a local request fails', async () => {
    const fetch = jest.fn().mockRejectedValue(new Error('ambiguous')); setFetch(fetch);
    const client = new PondApiClient('https://192.168.1.2:4443');
    const recover = jest.fn(async () => 'https://100.64.0.1:4443'); client.setRecovery(recover);
    client.setRefreshToken('fixture-refresh');
    await expect(client.requestLocal('https://192.168.1.2:4443', '/api/v1/remote-access/enrollment', { method: 'POST' })).rejects.toThrow('ambiguous');
    expect(fetch).toHaveBeenCalledTimes(1); expect(recover).not.toHaveBeenCalled();
    const unauthorized = stubFetch({ status: 401 }); setFetch(unauthorized);
    await expect(client.requestLocal('https://192.168.1.2:4443', '/api/v1/remote-access/configuration')).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });
  it('rejects remote and plaintext endpoints before sending credentials', async () => {
    const fetch = stubFetch({ status: 200 }); setFetch(fetch);
    const client = new PondApiClient();
    for (const url of ['https://100.64.0.1:4443', 'http://192.168.1.2:4443']) {
      await expect(client.requestLocal(url, '/api/v1/remote-access/configuration')).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

/**
 * The client's half of the channel binding.
 *
 * The pin is what this connection is pinned to, so `pair` folding it into the
 * proof is what stops the pin's own provenance mattering: a phone that pinned
 * an interceptor's key fails the pair instead of completing one against the
 * wrong Pond. That refusal is the Pond's; what is tested here is the other
 * direction -- something that terminated this connection and invented an
 * acceptance, which only the returned proof catches.
 */
describe('pair() channel binding', () => {
  const PIN = 'sha256/TnkUsN+AaLec3BDTh/KUwSokXTmCq2+4rlfBnmJxPkE=';
  const CHALLENGE = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
  const CODE = '482915';
  const CLIENT_ID = 'install-abcdef';
  const PROOF = '73171bac55bb3346045142bb0647057067d94712f5fab82d2260bf91c106ebe0';

  /** init, then verify answering with `verify`. */
  function pairingFetch(verify: Record<string, unknown>) {
    return jest.fn(async (url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify(
          String(url).endsWith('/init')
            ? { challenge_id: 'c1', challenge: CHALLENGE, expires_at: '' }
            : verify,
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  }

  const accepted = {
    accepted: true,
    session_token: 'session',
    refresh_token: 'refresh',
    hostname: 'nano',
    server_version: 'test',
    capabilities: [],
    rejection_reason: null,
  };

  it('sends the pin and the bound MAC, and keeps the tokens when the proof checks out', async () => {
    const fetch = pairingFetch({ ...accepted, server_proof: PROOF }); setFetch(fetch);
    const client = new PondApiClient('https://192.168.1.7:4443');

    const rotated = jest.fn(); client.setOnTokensRotated(rotated);

    const resp = await client.pair({ clientId: CLIENT_ID, pairingCode: CODE, channelBinding: PIN });

    expect(resp.accepted).toBe(true);
    expect(rotated).toHaveBeenCalledWith('session', 'refresh');
    const body = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    expect(body.channel_binding).toBe(PIN);
    expect(body.mac).toBe('2cc63017ff6979d0f1c4009a4f37c3c95bc2d535897fc2fb19a0a496f6a649aa');
  });

  // The interceptor's best remaining move once the Pond has refused its relay:
  // answer the phone itself. It cannot produce the proof without the code.
  it('rejects an acceptance whose proof is wrong, and keeps no token from it', async () => {
    for (const server_proof of [undefined, '00'.repeat(32), `f${PROOF.slice(1)}`]) {
      setFetch(pairingFetch({ ...accepted, server_proof }));
      const client = new PondApiClient('https://192.168.1.7:4443');
      const rotated = jest.fn(); client.setOnTokensRotated(rotated);
      await expect(
        client.pair({ clientId: CLIENT_ID, pairingCode: CODE, channelBinding: PIN }),
      ).rejects.toThrow();
      // Nothing is kept and nothing is persisted: the tokens in that response
      // came from whoever answered, not from the Pond.
      expect(rotated).not.toHaveBeenCalled();
    }
  });

  // The Pond names why it refused, so the screen can say something truer than "not on the LAN".
  it('carries the Pond\'s refusal identifier on a failed verify', async () => {
    const fetch = jest.fn(async (url: string) =>
      String(url).endsWith('/init')
        ? new Response(JSON.stringify({ challenge_id: 'c1', challenge: CHALLENGE, expires_at: '' }), { status: 200 })
        : new Response(JSON.stringify({ error: 'channel_binding_required' }), { status: 403 }),
    );
    setFetch(fetch);
    const client = new PondApiClient('https://192.168.1.7:4443');
    await expect(
      client.pair({ clientId: CLIENT_ID, pairingCode: CODE, channelBinding: PIN }),
    ).rejects.toMatchObject({ status: 403, detail: 'channel_binding_required' });
  });
});
