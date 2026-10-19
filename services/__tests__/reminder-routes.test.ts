/**
 * The reminder wrappers.
 *
 * Routes and bodies are checked against `list_reminders` and `dismiss_reminder`
 * in `pond-api/src/routes.rs`; a live Pond is still the real test.
 */

import { ApiError, PondApiClient } from '@/services/api-client';
import type { Reminder } from '@/services/types';

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
  body?: unknown;
}

function recordInto(seen: Seen[], body = '{}', status = 200) {
  setFetch(async (url: string, init?: { method?: string; body?: string }) => {
    seen.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
    return reply(body, status);
  });
}

afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else delete (globalThis as { fetch?: unknown }).fetch;
});

/** The wire shape `reminder_json` builds, field for field. */
const REMINDER: Reminder = {
  id: 'r1',
  about: 'Dentist appointment',
  when_said: 'next Tuesday',
  subject: 'Amina',
  profile_id: 'p1',
  said_at: '2026-10-18T09:00:00+00:00',
  captured_at: '2026-10-18T10:00:00+00:00',
  disposition: 'pending',
  session_id: 's1',
  window_id: 'w1',
};

describe('listReminders', () => {
  it('reads the pending list from the reminders route, unwrapping its envelope', async () => {
    const seen: Seen[] = [];
    recordInto(seen, JSON.stringify({ reminders: [REMINDER], limit: 100 }));
    const api = new PondApiClient('https://pond.test:4000');

    const list = await api.listReminders();

    expect(seen).toHaveLength(1);
    expect(seen[0].method ?? 'GET').toBe('GET');
    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/reminders');
    expect(list).toEqual([REMINDER]);
  });

  it('turns a refusal into an ApiError carrying the status', async () => {
    recordInto([], JSON.stringify({ error: 'could not read reminders' }), 500);
    const api = new PondApiClient('https://pond.test:4000');

    await expect(api.listReminders()).rejects.toMatchObject({ status: 500, detail: 'could not read reminders' });
  });
});

describe('dismissReminder', () => {
  it('posts to the dismiss route with the id escaped', async () => {
    const seen: Seen[] = [];
    recordInto(seen, JSON.stringify({ id: 'a/b', disposition: 'dismissed' }));
    const api = new PondApiClient('https://pond.test:4000');

    await api.dismissReminder('a/b');

    expect(seen[0].method).toBe('POST');
    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/reminders/a%2Fb/dismiss');
  });

  it('surfaces the 404 for a reminder that is no longer waiting', async () => {
    recordInto([], JSON.stringify({ error: 'no reminder is waiting under that id' }), 404);
    const api = new PondApiClient('https://pond.test:4000');

    const failure = await api.dismissReminder('gone').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(404);
  });
});
