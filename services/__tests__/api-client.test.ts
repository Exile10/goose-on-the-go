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

import { ApiError, PondApiClient, PondOutdatedError } from '@/services/api-client';
import { PondTrustError } from '@/services/pond-trust';

import { pakePond } from './support/pake-pond';

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
 * Pairing over CPace, against a fake Pond that runs the initiator's half for real.
 *
 * What the client owns is its own side of the exchange and the check on the
 * Pond's confirmation. The Pond refuses a wrong code or a relayed pin by failing
 * the phone's tag; what is tested here beyond that is the other direction --
 * something that terminated this connection and invented an acceptance, which
 * only the Pond's confirmation catches.
 */
describe('pair() over CPace', () => {
  const PIN = 'sha256/TnkUsN+AaLec3BDTh/KUwSokXTmCq2+4rlfBnmJxPkE=';
  const OTHER_PIN = `sha256/${'B'.repeat(43)}=`;
  const CODE = '048291';
  const CLIENT_ID = 'install-abcdef';

  let warn: jest.SpyInstance;
  beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
  afterEach(() => warn.mockRestore());

  const body = (fetch: jest.Mock, path: string) =>
    JSON.parse(String(fetch.mock.calls.find(([url]) => String(url).endsWith(path))?.[1]?.body));

  it('runs the exchange, sends only shares and tags, and keeps the tokens once the Pond confirms', async () => {
    const fetch = pakePond({ code: CODE, pin: PIN }); setFetch(fetch);
    const client = new PondApiClient('https://192.168.1.7:4443');
    const rotated = jest.fn(); client.setOnTokensRotated(rotated);

    const resp = await client.pair({ clientId: CLIENT_ID, pairingCode: CODE, channelBinding: PIN, deviceName: 'Phone' });

    expect(resp.accepted).toBe(true);
    expect(rotated).toHaveBeenCalledWith('session', 'refresh');
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/api/v1/system/info', '/api/v1/handshake/pake/init', '/api/v1/handshake/pake/verify',
    ]);
    const init = body(fetch, '/pake/init');
    expect(init).toMatchObject({ client_id: CLIENT_ID, channel_binding: PIN });
    expect(Buffer.from(init.client_nonce, 'base64')).toHaveLength(32);
    const verify = body(fetch, '/pake/verify');
    expect(Object.keys(verify).sort()).toEqual(['challenge_id', 'confirm', 'device_name', 'share']);
    expect(Buffer.from(verify.share, 'base64')).toHaveLength(32);
    expect(verify.confirm).toMatch(/^[0-9a-f]{128}$/);
    // The code never leaves the phone in any form a request carries.
    for (const [, req] of fetch.mock.calls) expect(String(req?.body ?? '')).not.toContain(CODE);
  });

  it('draws a fresh nonce and share every run', async () => {
    const fetch = pakePond({ code: CODE, pin: PIN }); setFetch(fetch);
    const client = new PondApiClient('https://192.168.1.7:4443');
    await client.pair({ clientId: CLIENT_ID, pairingCode: CODE, channelBinding: PIN });
    await client.pair({ clientId: CLIENT_ID, pairingCode: CODE, channelBinding: PIN });
    const inits = fetch.mock.calls.filter(([url]) => String(url).endsWith('/pake/init'));
    const verifies = fetch.mock.calls.filter(([url]) => String(url).endsWith('/pake/verify'));
    expect(JSON.parse(String(inits[0][1]?.body)).client_nonce).not.toBe(JSON.parse(String(inits[1][1]?.body)).client_nonce);
    expect(JSON.parse(String(verifies[0][1]?.body)).share).not.toBe(JSON.parse(String(verifies[1][1]?.body)).share);
  });

  // The Pond fails the phone's tag; the phone keeps nothing and says why.
  it.each([
    ['a wrong code', { code: '048290', pin: PIN }],
    ['a pin that is not the Pond\'s', { code: CODE, pin: OTHER_PIN }],
  ])('is refused for %s', async (_name, pond) => {
    setFetch(pakePond(pond));
    const client = new PondApiClient('https://192.168.1.7:4443');
    const rotated = jest.fn(); client.setOnTokensRotated(rotated);
    const resp = await client.pair({ clientId: CLIENT_ID, pairingCode: CODE, channelBinding: PIN });
    expect(resp).toMatchObject({ accepted: false, rejection_reason: 'invalid_confirmation' });
    expect(rotated).not.toHaveBeenCalled();
  });

  // The interceptor's best remaining move once the Pond has refused its relay:
  // answer the phone itself. It cannot produce the confirmation without the code.
  it('rejects an acceptance whose confirmation is wrong, and keeps no token from it', async () => {
    for (const server_proof of [undefined, null, '', 'zz', '00'.repeat(64), '00'.repeat(32)]) {
      setFetch(pakePond({ code: CODE, pin: PIN, accept: (answer) => ({ ...answer, server_proof }) }));
      const client = new PondApiClient('https://192.168.1.7:4443');
      const rotated = jest.fn(); client.setOnTokensRotated(rotated);
      await expect(client.pair({ clientId: CLIENT_ID, pairingCode: CODE, channelBinding: PIN }))
        .rejects.toBeInstanceOf(PondTrustError);
      expect(rotated).not.toHaveBeenCalled();
    }
  });

  // The Pond's real confirmation flipped in its last bit, and the phone's own tag sent back to it.
  it('rejects a near-miss and a reflected tag', async () => {
    const flip = (hex: string) => `${hex.slice(0, -1)}${(parseInt(hex.slice(-1), 16) ^ 1).toString(16)}`;
    for (const forge of [
      (answer: string) => flip(answer),
      (_answer: string, sent: string) => sent,
    ]) {
      let sent = '';
      const pond = pakePond({ code: CODE, pin: PIN,
        accept: (answer) => ({ ...answer, server_proof: forge(answer.server_proof ?? '', sent) }) });
      setFetch(jest.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/pake/verify')) sent = JSON.parse(String(init?.body)).confirm;
        return pond(url, init);
      }));
      const client = new PondApiClient('https://192.168.1.7:4443');
      await expect(client.pair({ clientId: CLIENT_ID, pairingCode: CODE, channelBinding: PIN }))
        .rejects.toBeInstanceOf(PondTrustError);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('confirmation did not verify'));
    }
  });

  it.each([
    ['an unknown suite', { suite: 'CPACE-X25519-SHA512' }],
    ['the identity as its share', { share: Buffer.alloc(32).toString('base64') }],
    ['a non-canonical share', { share: Buffer.from('2b3c6b8c4f3800e7aef6864025b4ed79bd599117e427c41bd47d93d654b4a51c', 'hex').toString('base64') }],
    ['a short challenge', { challenge: Buffer.alloc(16).toString('base64') }],
    ['a share that is not base64', { share: '***' }],
  ])('sends nothing derived from the code when the Pond answers with %s', async (_name, patch) => {
    const fetch = pakePond({ code: CODE, pin: PIN, init: (answer) => ({ ...answer, ...patch }) }); setFetch(fetch);
    const client = new PondApiClient('https://192.168.1.7:4443');
    await expect(client.pair({ clientId: CLIENT_ID, pairingCode: CODE, channelBinding: PIN }))
      .rejects.toBeInstanceOf(PondTrustError);
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/pake/verify'))).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('refused the Pond\'s CPace answer'), expect.anything());
  });

  it.each([[2], [null], [4]])('stops before the handshake when the Pond reports protocol %s', async (protocol) => {
    const fetch = pakePond({ code: CODE, pin: PIN, protocol }); setFetch(fetch);
    const client = new PondApiClient('https://192.168.1.7:4443');
    await expect(client.pair({ clientId: CLIENT_ID, pairingCode: CODE, channelBinding: PIN }))
      .rejects.toBeInstanceOf(PondOutdatedError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pairing protocol'), protocol ?? 'none', expect.anything());
  });

  // The Pond names why it refused, so the screen can say something truer than "not on the LAN".
  it('carries the Pond\'s refusal identifier on a failed init and verify', async () => {
    for (const failing of ['/pake/init', '/pake/verify']) {
      const pond = pakePond({ code: CODE, pin: PIN });
      setFetch(jest.fn(async (url: string, init?: RequestInit) => String(url).endsWith(failing)
        ? new Response(JSON.stringify({ error: 'channel_binding_mismatch' }), { status: 403 })
        : pond(url, init)));
      const client = new PondApiClient('https://192.168.1.7:4443');
      await expect(client.pair({ clientId: CLIENT_ID, pairingCode: CODE, channelBinding: PIN }))
        .rejects.toMatchObject({ status: 403, detail: 'channel_binding_mismatch' });
    }
  });
});
