jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
/**
 * The camera and vision wrappers.
 *
 * Routes and shapes are the Pond's (`pond-api/src/routes.rs`, and `.ai/vision-finish-plan.md` for
 * what the vision finish adds). A live Pond is still the real test.
 */

import { ApiError, PondApiClient, readCameraEvent } from '@/services/api-client';

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

function setFetch(impl: unknown) {
  Object.defineProperty(globalThis, 'fetch', { value: impl, configurable: true, writable: true });
}

/** A `Response` stand-in carrying only what `request()`, `open()` and `readSse()` read. */
function reply(body: string, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

interface Seen {
  url: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function recordInto(seen: Seen[], body = '{}', status = 200, headers: Record<string, string> = {}) {
  setFetch(async (url: string, init?: { method?: string; body?: unknown; headers?: Headers }) => {
    seen.push({
      url,
      method: init?.method,
      body: init?.body,
      headers: init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined,
    });
    return reply(body, status, headers);
  });
}

afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else delete (globalThis as { fetch?: unknown }).fetch;
});

const api = () => {
  const client = new PondApiClient('https://pond.test:4000');
  client.setToken('session-token');
  return client;
};

const EVENT = {
  id: 42,
  camera_id: 'front door',
  event_type: 'person',
  confidence: 0.94,
  snapshot_path: '/data/snapshots/front-door-1.jpg',
  snapshot_url: '/api/v1/camera/events/42/snapshot',
  metadata: { changed_fraction: 0.12, source: 'vision', face_detected: true, face_unknown: false, identified_profile: 'amina', face_confidence: 0.81 },
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

  it('reads an event from a Pond that sends no picture and no acknowledgement', async () => {
    recordInto([], JSON.stringify({ events: [{ id: 7, camera_id: 'c', event_type: 'motion', confidence: 0.1, snapshot_path: '/x', created_at: 't' }] }));

    const [event] = await api().listCameraEvents('c');

    expect(event).toMatchObject({ id: 7, snapshot_url: null, metadata: null, acknowledged: false });
  });
});

describe('readCameraEvent', () => {
  it('reads metadata a camera posted as JSON text, and drops text that is not JSON', () => {
    const posted = readCameraEvent({ ...EVENT, metadata: '{"face_unknown":true}' });
    expect(posted?.metadata).toEqual({ face_unknown: true });
    expect(readCameraEvent({ ...EVENT, metadata: 'not json' })?.metadata).toBeNull();
    expect(readCameraEvent({ ...EVENT, metadata: ['a'] })?.metadata).toBeNull();
  });

  it('refuses what is not an event', () => {
    expect(readCameraEvent(null)).toBeNull();
    expect(readCameraEvent({ camera_id: 'c' })).toBeNull();
    expect(readCameraEvent({ id: 'x', event_type: 'person' })).toBeNull();
  });
});

describe('acknowledgeCameraEvent', () => {
  it('PATCHes the event with no body, which the route does not read', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"status":"ok"}');

    await api().acknowledgeCameraEvent(42);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ url: 'https://pond.test:4000/api/v1/camera/events/42/acknowledge', method: 'PATCH' });
    expect(seen[0].body).toBeUndefined();
  });

  it('raises a refusal', async () => {
    recordInto([], '{"error":"boom"}', 500);
    await expect(api().acknowledgeCameraEvent(42)).rejects.toMatchObject({ status: 500 });
  });
});

describe('streamVisionEvents', () => {
  it('delivers each vision_event as an event and ignores every other frame', async () => {
    const seen: string[] = [];
    setFetch(async (url: string) => {
      seen.push(url);
      return reply(
        `event: vision_event\ndata: ${JSON.stringify({ ...EVENT, id: 1 })}\n\n` +
          `: keep-alive\n\n` +
          `event: other\ndata: ${JSON.stringify({ ...EVENT, id: 2 })}\n\n` +
          `event: vision_event\ndata: not json\n\n` +
          `event: vision_event\ndata: ${JSON.stringify({ id: 3, event_type: 'pet', camera_id: 'c', created_at: 't' })}\n\n`,
      );
    });

    const events: number[] = [];
    let opened = 0;
    await api().streamVisionEvents((e) => events.push(e.id), undefined, () => (opened += 1));

    expect(seen).toEqual(['https://pond.test:4000/api/v1/vision/events/stream']);
    expect(events).toEqual([1, 3]);
    expect(opened).toBe(1);
  });

  it('carries the Pond reason of a refusal in the error body', async () => {
    recordInto([], '{"error":"Cameras are off","reason":"cameras_disabled"}', 403);

    await expect(api().streamVisionEvents(() => undefined)).rejects.toMatchObject({
      status: 403,
      detail: 'Cameras are off',
      body: { reason: 'cameras_disabled' },
    });
  });
});

describe('visionStatus and visionConfig', () => {
  it('reads the status route', async () => {
    const seen: Seen[] = [];
    recordInto(seen, JSON.stringify({ state: 'running', camera_id: 'camera-1' }));

    const status = await api().visionStatus();

    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/vision/status');
    expect(status.state).toBe('running');
  });

  it('PUTs a config patch to the config route', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{}');

    await api().updateVisionConfig({ vision_fps: 3 });

    expect(seen[0]).toMatchObject({ url: 'https://pond.test:4000/api/v1/vision/config', method: 'PUT', body: '{"vision_fps":3}' });
  });
});

describe('listCameras', () => {
  it('reads the contract shape', async () => {
    recordInto([], JSON.stringify({ cameras: [{ id: 'camera-1', live: true, last_frame_at: '2026-10-26T12:00:01Z', snapshot_url: '/api/v1/camera/camera-1/snapshot', stream_url: '/api/v1/camera/camera-1/stream' }] }));

    await expect(api().listCameras()).resolves.toEqual([
      { id: 'camera-1', live: true, last_frame_at: '2026-10-26T12:00:01Z', snapshot_url: '/api/v1/camera/camera-1/snapshot', stream_url: '/api/v1/camera/camera-1/stream' },
    ]);
  });

  it('reads an older Pond, which calls `live` `is_live` and sends no timestamp', async () => {
    recordInto([], JSON.stringify({ cameras: [{ id: 'camera-1', name: 'camera-1', is_live: true }, { name: 'no id' }] }));

    await expect(api().listCameras()).resolves.toEqual([
      { id: 'camera-1', live: true, last_frame_at: null, snapshot_url: null, stream_url: null },
    ]);
  });
});

describe('fetchImage', () => {
  it('sends the bearer in a header, never in the address, and returns a data URI of the bytes', async () => {
    const seen: Seen[] = [];
    recordInto(seen, 'jpegbytes', 200, { 'Content-Type': 'image/jpeg' });

    const uri = await api().fetchImage(api().cameraSnapshotPath('front door'));

    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/camera/front%20door/snapshot');
    expect(seen[0].url).not.toContain('token');
    expect(seen[0].headers?.authorization).toBe('Bearer session-token');
    expect(uri).toBe(`data:image/jpeg;base64,${btoa('jpegbytes')}`);
  });

  it('refuses a path that is not the Pond’s own API, so the token goes nowhere else', async () => {
    const seen: Seen[] = [];
    recordInto(seen);

    await expect(api().fetchImage('https://elsewhere.example/a.jpg')).rejects.toThrow('Invalid Pond API path');
    await expect(api().fetchImage('//elsewhere.example/api/x')).rejects.toThrow('Invalid Pond API path');
    expect(seen).toEqual([]);
  });

  it('carries the Pond reason when the snapshot is refused', async () => {
    recordInto([], '{"error":"Cameras are off","reason":"cameras_disabled"}', 403);

    const refusal = await api().fetchImage('/api/v1/camera/camera-1/snapshot').catch((e) => e);

    expect(refusal).toBeInstanceOf(ApiError);
    expect(refusal.status).toBe(403);
    expect(refusal.body).toEqual({ error: 'Cameras are off', reason: 'cameras_disabled' });
  });
});

describe('faces', () => {
  it('lists every household member with how many samples the pond holds', async () => {
    const seen: Seen[] = [];
    recordInto(
      seen,
      JSON.stringify({
        available: true,
        default_threshold: 0.45,
        people: [
          { profile_id: 'amina', name: 'Amina', enrollments: 4, threshold: 0.5, last_enrolled_at: '2026-10-20T10:00:00Z' },
          { profile_id: 'baraka', name: '', enrollments: 0, threshold: null, last_enrolled_at: null },
          { name: 'no id' },
        ],
      }),
    );

    const overview = await api().listFaces();

    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/faces');
    expect(overview).toEqual({
      available: true,
      default_threshold: 0.45,
      people: [
        { profile_id: 'amina', name: 'Amina', enrollments: 4, threshold: 0.5, last_enrolled_at: '2026-10-20T10:00:00Z' },
        { profile_id: 'baraka', name: 'baraka', enrollments: 0, threshold: null, last_enrolled_at: null },
      ],
    });
  });

  it('reads a Pond with no face build as unavailable rather than as an error', async () => {
    recordInto([], '{"available":false,"default_threshold":0.4,"people":[]}');
    await expect(api().listFaces()).resolves.toMatchObject({ available: false, people: [] });
  });

  it('takes a sample from the pond camera, naming the camera only when asked', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"id":9,"profile_id":"amina","model_dims":512,"created_at":"t"}');

    await api().registerFaceFromCamera('amina');
    await api().registerFaceFromCamera('amina', 'garage');

    expect(seen.map((s) => [s.url, s.method, s.body])).toEqual([
      ['https://pond.test:4000/api/v1/faces/register-from-camera', 'POST', '{"profile_id":"amina"}'],
      ['https://pond.test:4000/api/v1/faces/register-from-camera', 'POST', '{"profile_id":"amina","camera_id":"garage"}'],
    ]);
  });

  it('carries the reason a camera sample was refused', async () => {
    recordInto([], '{"error":"no face in the frame","reason":"no_face"}', 422);

    const refusal = await api().registerFaceFromCamera('amina').catch((e) => e);

    expect(refusal).toBeInstanceOf(ApiError);
    expect(refusal.status).toBe(422);
    expect((refusal.body as { reason: string }).reason).toBe('no_face');
  });

  it('sets, clears and reads one person’s strictness, and forgets their face', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"profile_id":"amina","threshold":0.5}');

    await api().getFaceThreshold('amina');
    await api().setFaceThreshold('amina', 0.5);
    await api().clearFaceThreshold('amina');
    await api().forgetFace('amina');

    expect(seen.map((s) => [s.method ?? 'GET', s.url.replace('https://pond.test:4000', ''), s.body])).toEqual([
      ['GET', '/api/v1/faces/profile/amina/threshold', undefined],
      ['PUT', '/api/v1/faces/profile/amina/threshold', '{"threshold":0.5}'],
      ['DELETE', '/api/v1/faces/profile/amina/threshold', undefined],
      ['DELETE', '/api/v1/users/amina/biometrics', undefined],
    ]);
  });
});
