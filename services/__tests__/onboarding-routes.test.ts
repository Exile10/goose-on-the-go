/**
 * Checked against `pond-api/src/routes.rs`. Every setup call carries the bearer token even while the
 * Pond answers without one, because the Pond's next phase refuses a tokenless caller once it is claimed.
 */

import { ApiError, PondApiClient } from '@/services/api-client';

// Hoisted above the import by Jest; written after it so the imports stay first.
jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

function setFetch(impl: unknown) {
  Object.defineProperty(globalThis, 'fetch', { value: impl, configurable: true, writable: true });
}

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
  body?: unknown;
  auth?: string | null;
}

function recordInto(seen: Seen[], body = '{}', status = 200) {
  setFetch(async (url: string, init?: { method?: string; body?: string; headers?: Headers }) => {
    seen.push({
      url,
      method: init?.method,
      body: init?.body ? JSON.parse(init.body) : undefined,
      auth: init?.headers?.get('Authorization') ?? null,
    });
    return reply(body, status);
  });
}

afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else delete (globalThis as { fetch?: unknown }).fetch;
});

const BASE = 'https://pond.test:4000/api/v1';
function api(token: string | null = 'session-token') {
  const client = new PondApiClient('https://pond.test:4000');
  client.setToken(token);
  return client;
}

const STATUS = '{"onboarded":false,"current_step":"Basics","steps_completed":2,"total_steps":10}';

describe('setup progress', () => {
  it('reads where setup stands', async () => {
    const seen: Seen[] = [];
    recordInto(seen, STATUS);
    const status = await api().onboardStatus();
    expect(seen[0]).toMatchObject({ url: `${BASE}/onboard/status`, auth: 'Bearer session-token' });
    expect(status).toEqual({ onboarded: false, current_step: 'Basics', steps_completed: 2, total_steps: 10 });
  });

  it('records a step by its backend name', async () => {
    const seen: Seen[] = [];
    recordInto(seen, STATUS);
    await api().recordOnboardStep('GooseIdentity');
    expect(seen[0]).toMatchObject({ url: `${BASE}/onboard/step/GooseIdentity`, method: 'POST', auth: 'Bearer session-token' });
  });
});

describe('finishing', () => {
  it('answers done on a 200', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"status":"completed"}');
    await expect(api().completeOnboarding()).resolves.toEqual({ completed: true });
    expect(seen[0]).toMatchObject({ url: `${BASE}/onboard/complete`, method: 'POST', auth: 'Bearer session-token' });
  });

  it('carries My Pond’s key when the Pond gives the claiming phone one, and nothing else', async () => {
    recordInto([], '{"status":"completed","admin_key":"key-1"}');
    await expect(api().completeOnboarding()).resolves.toStrictEqual({ completed: true, adminKey: 'key-1' });
    recordInto([], '{"status":"completed","admin_key":42}');
    await expect(api().completeOnboarding()).resolves.toStrictEqual({ completed: true });
  });

  it('answers the fields the Pond would not finish without, rather than failing', async () => {
    recordInto(
      [],
      '{"error":"Onboarding is incomplete — required settings are missing.","missing_fields":["user_name","chat_model"]}',
      400,
    );
    await expect(api().completeOnboarding()).resolves.toEqual({ completed: false, missing: ['user_name', 'chat_model'] });
  });

  it('still fails on a refusal that names no fields', async () => {
    recordInto([], '{"error":"Failed to save onboarding state"}', 500);
    await expect(api().completeOnboarding()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('the owner’s profile', () => {
  it('sends the whole preference map in a PATCH, which the Pond stores in place of the old one', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"id":"p1","display_name":"Amina","preferences":{"language":"sw"}}');
    await api().setProfilePrefs('p1', { language: 'sw', accessibility_slow_speech: 'false' });
    expect(seen[0]).toEqual({
      url: `${BASE}/profiles/p1`,
      method: 'PATCH',
      body: { preferences: { language: 'sw', accessibility_slow_speech: 'false' } },
      auth: 'Bearer session-token',
    });
  });
});

describe('warm-up', () => {
  it('reads the flattened phase', async () => {
    recordInto([], '{"state":"warming","model":"gemma","started_unix_ms":1,"finished_unix_ms":null,"elapsed_ms":40}');
    await expect(api().warmup()).resolves.toMatchObject({ state: 'warming', model: 'gemma' });
  });
});

describe('a Pond nobody has set up', () => {
  const refusal = '{"error":"onboarding_required","message":"Complete onboarding before using this feature"}';

  it('says so once per refused request', async () => {
    const client = api();
    const required = jest.fn();
    client.setOnboardingRequired(required);
    recordInto([], refusal, 403);
    await expect(client.listProfiles()).rejects.toMatchObject({ status: 403, detail: 'onboarding_required' });
    expect(required).toHaveBeenCalledTimes(1);
  });

  it('does not take any other 403 for it', async () => {
    const client = api();
    const required = jest.fn();
    client.setOnboardingRequired(required);
    recordInto([], '{"error":"forbidden"}', 403);
    await expect(client.listProfiles()).rejects.toMatchObject({ status: 403 });
    expect(required).not.toHaveBeenCalled();
  });
});

describe('a voice sample on the Pond’s speaker (P4)', () => {
  it('asks for the voice by id, with the token', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '', 202);
    await api().voiceSample('af_heart');
    expect(seen).toEqual([{ url: `${BASE}/voice/sample`, method: 'POST', body: { voice: 'af_heart' }, auth: 'Bearer session-token' }]);
  });

  it('carries each refusal by its code', async () => {
    recordInto([], '{"error":"unknown_voice"}', 404);
    await expect(api().voiceSample('nope')).rejects.toMatchObject({ status: 404, detail: 'unknown_voice' });
    recordInto([], '{"error":"voice_unavailable"}', 503);
    await expect(api().voiceSample('af_heart')).rejects.toMatchObject({ status: 503, detail: 'voice_unavailable' });
  });
});
