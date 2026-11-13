/**
 * The wrappers a push wake uses to pull its notification.
 *
 * Routes and bodies are checked against `notifications_pending` and
 * `acknowledge_notification` in `pond-api/src/routes.rs`; a live Pond is still
 * the real test.
 */

import { ApiError, PondApiClient } from '@/services/api-client';
import type { ServerNotification } from '@/services/notification-stream';

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

/** The wire shape of the Pond's `Notification`, field for field. */
const DOOR: ServerNotification = {
  id: 'n-1:phone-a',
  target: 'phone-a',
  category: 'alert',
  title: 'Front door opened',
  body: 'Hallway',
  timestamp: '2026-10-30T21:42:00Z',
};

describe('pendingNotifications', () => {
  it('reads the pending route and unwraps its envelope', async () => {
    const seen: Seen[] = [];
    recordInto(seen, JSON.stringify({ notifications: [DOOR] }));
    const api = new PondApiClient('https://pond.test:4000');

    const list = await api.pendingNotifications();

    expect(seen).toEqual([{ url: 'https://pond.test:4000/api/v1/notifications/pending', method: undefined, body: undefined }]);
    expect(list).toEqual([DOOR]);
  });

  it('reads a missing list as nothing waiting', async () => {
    recordInto([], '{}');
    await expect(new PondApiClient('https://pond.test:4000').pendingNotifications()).resolves.toEqual([]);
  });
});

describe('acknowledgeNotification', () => {
  it('posts to the ack route with the id escaped', async () => {
    const seen: Seen[] = [];
    recordInto(seen, JSON.stringify({ id: DOOR.id, acknowledged: true }));

    await new PondApiClient('https://pond.test:4000').acknowledgeNotification(DOOR.id);

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/notifications/n-1%3Aphone-a/ack');
    expect(seen[0].method).toBe('POST');
  });

  it('says a notice was shown only when asked to', async () => {
    const seen: Seen[] = [];
    recordInto(seen, JSON.stringify({ id: DOOR.id, acknowledged: true }));
    const api = new PondApiClient('https://pond.test:4000');

    await api.acknowledgeNotification(DOOR.id, true);
    await api.ackNotification(DOOR.id, true);
    await api.ackNotification(DOOR.id);

    expect(seen.map((s) => s.body)).toEqual([{ shown: true }, { shown: true }, {}]);
  });

  it('surfaces a 404 for a notification that is not this phone’s', async () => {
    recordInto([], JSON.stringify({ error: 'no such notification for this device' }), 404);
    await expect(new PondApiClient('https://pond.test:4000').acknowledgeNotification('x'))
      .rejects.toBeInstanceOf(ApiError);
  });
});

describe('notificationOpened', () => {
  it('posts to the opened route with the id escaped and no body', async () => {
    const seen: Seen[] = [];
    recordInto(seen, JSON.stringify({ id: DOOR.id, opened: true }));

    await new PondApiClient('https://pond.test:4000').notificationOpened(DOOR.id);

    expect(seen).toEqual([{ url: 'https://pond.test:4000/api/v1/notifications/n-1%3Aphone-a/opened', method: 'POST', body: undefined }]);
  });

  it('surfaces a 404 for a notice that is not this phone’s', async () => {
    recordInto([], JSON.stringify({ error: 'no such notification for this device' }), 404);
    await expect(new PondApiClient('https://pond.test:4000').notificationOpened('x')).rejects.toBeInstanceOf(ApiError);
  });
});
