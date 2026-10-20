jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
/**
 * The camera-event wrappers.
 *
 * Routes and shapes are the Pond's (`pond-api/src/routes.rs`: `list_camera_events`,
 * `acknowledge_camera_event`). A live Pond is still the real test.
 */

import { ApiError, PondApiClient } from '@/services/api-client';

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
  setFetch(async (url: string, init?: { method?: string; body?: unknown }) => {
    seen.push({ url, method: init?.method, body: init?.body });
    return reply(body, status);
  });
}

afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else delete (globalThis as { fetch?: unknown }).fetch;
});

const api = () => new PondApiClient('https://pond.test:4000');

const EVENT = {
  id: 42,
  camera_id: 'front door',
  event_type: 'person',
  confidence: 0.94,
  snapshot_path: '/data/snapshots/front-door-1.jpg',
  acknowledged: false,
  created_at: '2026-10-19T08:00:01+00:00',
};

describe('listCameraEvents', () => {
  it('asks for one camera, escaped, with the limit, and unwraps `events`', async () => {
    const seen: Seen[] = [];
    recordInto(seen, JSON.stringify({ events: [EVENT] }));

    const list = await api().listCameraEvents('front door', 50);

    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/camera/events?camera_id=front+door&limit=50');
    expect(seen[0].method).toBeUndefined();
    expect(list).toEqual([EVENT]);
  });

  it('leaves the limit to the Pond when none is given', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"events":[]}');

    await api().listCameraEvents('camera-1');

    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/camera/events?camera_id=camera-1');
  });

  it('reads an answer without `events` as nothing seen', async () => {
    recordInto([], '{}');
    await expect(api().listCameraEvents('camera-1')).resolves.toEqual([]);
  });

  it('raises the Pond refusal as an ApiError', async () => {
    recordInto([], '{"error":"database is locked"}', 500);
    await expect(api().listCameraEvents('camera-1')).rejects.toMatchObject({ status: 500 });
    await expect(api().listCameraEvents('camera-1')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('acknowledgeCameraEvent', () => {
  it('PATCHes the event with no body, which the route does not read', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"status":"ok"}');

    await api().acknowledgeCameraEvent(42);

    expect(seen).toEqual([
      { url: 'https://pond.test:4000/api/v1/camera/events/42/acknowledge', method: 'PATCH', body: undefined },
    ]);
  });

  it('raises a refusal', async () => {
    recordInto([], '{"error":"boom"}', 500);
    await expect(api().acknowledgeCameraEvent(42)).rejects.toMatchObject({ status: 500 });
  });
});
