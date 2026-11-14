/**
 * The pairing lock's routes: a waiting phone coming back for its answer, the recovery PIN, and
 * what a paired member reads and changes. Statuses are the Pond's `pairing_lock.rs`.
 */

import type { HeldPairing } from '@/models/pairing-lock';
import { ApiError, PondApiClient } from '@/services/api-client';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

interface Seen {
  url: string;
  method?: string;
  body?: unknown;
  authorization: string | null;
}

function serve(status: number, body: unknown, headers: Record<string, string> = {}) {
  const seen: Seen[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    seen.push({
      url,
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: new Headers(init?.headers).get('Authorization'),
    });
    return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  };
  Object.defineProperty(globalThis, 'fetch', { value: fetch, configurable: true, writable: true });
  return seen;
}

afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
});

const ORIGIN = 'https://pond.test:4443';
const held: HeldPairing = { requestId: 'req-1', claimSecret: 'claim-secret', expiresAt: '2026-11-13T10:10:00Z', capabilities: ['voice_notes'] };
const paired = { status: 'paired', accepted: true, session_token: 'session', refresh_token: 'refresh', expires_at: '2026-11-14T10:00:00Z' };

describe('claimPairingRequest', () => {
  it('sends the request and its secret, with no bearer', async () => {
    const seen = serve(202, { status: 'waiting' });
    const client = new PondApiClient(ORIGIN);
    client.setToken('an-old-session');

    await expect(client.claimPairingRequest(held)).resolves.toEqual({ status: 'waiting' });

    expect(seen).toEqual([
      {
        url: `${ORIGIN}/api/v1/handshake/pairing-request/claim`,
        method: 'POST',
        body: { request_id: 'req-1', claim_secret: 'claim-secret' },
        authorization: null,
      },
    ]);
  });

  it('keeps the tokens of a phone that was let in, as an accepted pairing keeps them', async () => {
    serve(200, paired);
    const client = new PondApiClient(ORIGIN);
    const rotated = jest.fn();
    client.setOnTokensRotated(rotated);

    const claim = await client.claimPairingRequest(held);

    expect(claim).toMatchObject({ status: 'paired', response: { accepted: true, session_token: 'session', refresh_token: 'refresh' } });
    expect(rotated).toHaveBeenCalledWith('session', 'refresh');
    expect(client.signedIn).toBe(true);
    // The claim's answer names no capabilities; the ones the Pond gave with the request stand.
    expect(claim.status === 'paired' && claim.response.capabilities).toEqual(['voice_notes']);
  });

  it('reads a decline and a request that is gone', async () => {
    serve(403, { status: 'declined' });
    await expect(new PondApiClient(ORIGIN).claimPairingRequest(held)).resolves.toEqual({ status: 'declined' });
    serve(410, { status: 'gone' });
    await expect(new PondApiClient(ORIGIN).claimPairingRequest(held)).resolves.toEqual({ status: 'gone' });
  });

  it('keeps no token and throws for a 403 that is not a decline, and for an acceptance with no session', async () => {
    serve(403, { error: 'lan_only' });
    const off = new PondApiClient(ORIGIN);
    await expect(off.claimPairingRequest(held)).rejects.toMatchObject({ status: 403, detail: 'lan_only' });
    expect(off.signedIn).toBe(false);

    serve(200, { status: 'paired', accepted: true });
    const empty = new PondApiClient(ORIGIN);
    await expect(empty.claimPairingRequest(held)).rejects.toBeInstanceOf(ApiError);
    expect(empty.signedIn).toBe(false);
  });
});

describe('recoverPairingRequest', () => {
  it('sends the PIN beside the request, and keeps the tokens when it is right', async () => {
    const seen = serve(200, paired);
    const client = new PondApiClient(ORIGIN);

    await expect(client.recoverPairingRequest(held, '246810')).resolves.toMatchObject({ status: 'paired' });

    expect(seen[0]).toMatchObject({
      url: `${ORIGIN}/api/v1/handshake/pairing-request/recover`,
      body: { request_id: 'req-1', claim_secret: 'claim-secret', pin: '246810' },
    });
    expect(client.signedIn).toBe(true);
  });

  it('says how many tries a wrong PIN leaves', async () => {
    serve(403, { error: 'wrong_pin', tries_left: 3 });
    await expect(new PondApiClient(ORIGIN).recoverPairingRequest(held, '000000')).resolves.toEqual({ status: 'wrong_pin', triesLeft: 3 });
  });

  it('says how long to wait after too many, from the body or the header', async () => {
    serve(429, { error: 'pin_cooling', retry_after_secs: 90 });
    await expect(new PondApiClient(ORIGIN).recoverPairingRequest(held, '000000')).resolves.toEqual({ status: 'cooling', retryAfterSecs: 90 });
    serve(429, { error: 'pin_cooling' }, { 'Retry-After': '45' });
    await expect(new PondApiClient(ORIGIN).recoverPairingRequest(held, '000000')).resolves.toEqual({ status: 'cooling', retryAfterSecs: 45 });
  });

  it('says when the Pond has no recovery PIN, and reads a decline or a request that is gone', async () => {
    serve(409, { error: 'no_recovery_pin' });
    await expect(new PondApiClient(ORIGIN).recoverPairingRequest(held, '246810')).resolves.toEqual({ status: 'no_pin' });
    serve(410, { status: 'gone' });
    await expect(new PondApiClient(ORIGIN).recoverPairingRequest(held, '246810')).resolves.toEqual({ status: 'gone' });
  });

  it('throws for anything else', async () => {
    serve(500, { error: 'pairing_lock_unavailable' });
    await expect(new PondApiClient(ORIGIN).recoverPairingRequest(held, '246810')).rejects.toMatchObject({ status: 500 });
  });
});

describe('the lock, for a paired member', () => {
  it('reads the lock and the phones waiting', async () => {
    serve(200, { locked: true, enforced: true, owner_profile_id: 'p1', has_recovery_pin: true, owner_has_a_phone: true, min_pin_digits: 6, can_change: false });
    await expect(new PondApiClient(ORIGIN).pairingLock()).resolves.toMatchObject({ locked: true, enforced: true, canChange: false });

    const seen = serve(200, { requests: [{ id: 'r1', device_name: 'A phone', client_type: 'gotg' }] });
    await expect(new PondApiClient(ORIGIN).pairingRequests()).resolves.toMatchObject([{ id: 'r1', deviceName: 'A phone' }]);
    expect(seen[0].url).toBe(`${ORIGIN}/api/v1/pairing/requests`);
  });

  it('changes the lock and the recovery PIN, and answers a waiting phone', async () => {
    const seen = serve(200, {});
    const client = new PondApiClient(ORIGIN);

    await client.setPairingLock(true);
    await client.setRecoveryPin('246810');
    await client.clearRecoveryPin();
    await client.approvePairingRequest('r/1');
    await client.approvePairingRequest('r2', 'p2');
    await client.declinePairingRequest('r3');

    expect(seen.map((s) => [s.method, s.url.replace(ORIGIN, ''), s.body])).toEqual([
      ['PUT', '/api/v1/pairing/lock', { locked: true }],
      ['PUT', '/api/v1/pairing/recovery-pin', { pin: '246810' }],
      ['DELETE', '/api/v1/pairing/recovery-pin', undefined],
      ['POST', '/api/v1/pairing/requests/r%2F1/approve', {}],
      ['POST', '/api/v1/pairing/requests/r2/approve', { profile_id: 'p2' }],
      ['POST', '/api/v1/pairing/requests/r3/decline', {}],
    ]);
  });

  it('carries the refusal for anyone but the main member', async () => {
    serve(403, { error: 'pairing_main_member_only' });
    await expect(new PondApiClient(ORIGIN).setPairingLock(false)).rejects.toMatchObject({ status: 403, detail: 'pairing_main_member_only' });
  });
});
