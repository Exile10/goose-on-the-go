/**
 * The secret store's routes: `GET /secrets`, `PUT /secrets/{key}`, `DELETE /secrets/{key}`
 * (pond-api `routes.rs`, `list_secrets_handler` and its neighbours).
 *
 * What is pinned: the value goes in the PUT body and nowhere else, the key is one encoded path
 * segment, the paired token goes with all three, the PUT's restart report is read rather than
 * dropped, a listing that is not one is not passed off as empty, and the Pond's 403 for a
 * member's Uber key reaches the caller with its code.
 */

import { isReservedRefusal } from '@/models/secrets';
import { ApiError, PondApiClient } from '@/services/api-client';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

function setFetch(impl: unknown) {
  Object.defineProperty(globalThis, 'fetch', { value: impl, configurable: true, writable: true });
}

/** A `Response` stand-in carrying only what `request()` reads. */
function reply(body: string, status = 200) {
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
  rawBody?: string;
  authorization: string | null;
}

function recordInto(seen: Seen[], body: string, status = 200) {
  setFetch(async (url: string, init?: { method?: string; body?: string; headers?: Headers }) => {
    seen.push({
      url,
      method: init?.method,
      rawBody: init?.body,
      authorization: init?.headers?.get('Authorization') ?? null,
    });
    return reply(body, status);
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

describe('GET /api/v1/secrets', () => {
  it('lists the key names with the paired token', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"keys":["SPOTIFY_CLIENT_ID","GITHUB_PERSONAL_ACCESS_TOKEN"]}');

    const keys = await paired().listSecretKeys();

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/secrets');
    expect(seen[0].method).toBeUndefined();
    expect(seen[0].authorization).toBe('Bearer session-token');
    expect(keys).toEqual(['SPOTIFY_CLIENT_ID', 'GITHUB_PERSONAL_ACCESS_TOKEN']);
  });

  it('refuses a body that is not a listing, rather than reading it as no keys', async () => {
    recordInto([], '{"status":"ok"}');
    await expect(paired().listSecretKeys()).rejects.toThrow('unexpected');
  });

  it('drops entries that are not names', async () => {
    recordInto([], '{"keys":["A_KEY",3,null]}');
    await expect(paired().listSecretKeys()).resolves.toEqual(['A_KEY']);
  });
});

describe('PUT /api/v1/secrets/{key}', () => {
  it('sends the value in the body only, under one encoded path segment', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"key":"A/B","stored":true,"restarted":[],"restart_errors":{}}');

    await paired().setSecret('A/B', 'the-value');

    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/secrets/A%2FB');
    expect(seen[0].url).not.toContain('the-value');
    expect(seen[0].method).toBe('PUT');
    expect(seen[0].authorization).toBe('Bearer session-token');
    expect(JSON.parse(seen[0].rawBody ?? '')).toEqual({ value: 'the-value' });
  });

  it('reads which extensions restarted and which could not', async () => {
    recordInto(
      [],
      '{"key":"SLACK_BOT_TOKEN","stored":true,"restarted":["slack"],"restart_errors":{"github":"spawn failed"}}',
    );

    await expect(paired().setSecret('SLACK_BOT_TOKEN', 'x')).resolves.toEqual({
      restarted: ['slack'],
      restartFailed: ['github'],
    });
  });

  it('reads a bare success as nothing restarted', async () => {
    recordInto([], '{}');
    await expect(paired().setSecret('K', 'x')).resolves.toEqual({ restarted: [], restartFailed: [] });
  });

  it('carries the 403 for a member Uber key with its code', async () => {
    recordInto([], '{"error":"Uber sign-ins belong to each member","code":"secret_reserved"}', 403);

    const refused = await paired().setSecret('UBER_ALICE', 'x').catch((e: unknown) => e);

    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).status).toBe(403);
    expect(isReservedRefusal(refused)).toBe(true);
  });

  it('does not read any other 403 as the reserved-key refusal', () => {
    expect(isReservedRefusal(new ApiError('PUT → 403', 403, null, 'onboarding_required', { error: 'onboarding_required' }))).toBe(false);
    expect(isReservedRefusal(new ApiError('PUT → 400', 400, null, null, { code: 'secret_reserved' }))).toBe(false);
  });
});

describe('DELETE /api/v1/secrets/{key}', () => {
  it('deletes by encoded key with the paired token, and reads the 204 as done', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '', 204);

    await expect(paired().deleteSecret('SPOTIFY_CLIENT_ID')).resolves.toBeUndefined();

    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/secrets/SPOTIFY_CLIENT_ID');
    expect(seen[0].method).toBe('DELETE');
    expect(seen[0].authorization).toBe('Bearer session-token');
    expect(seen[0].rawBody).toBeUndefined();
  });
});
