/**
 * The vision-events view-model: which camera it asks for, what a failed read or acknowledgement
 * leaves on screen, the filters, and the stream that brings new events in with the poll as what
 * is left when it is not open.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import { currentSnackbar, resetSnackbar } from '@/services/snackbar';
import type { CameraEvent } from '@/services/types';
import {
  STREAM_RETRY_MAX_MS,
  STREAM_RETRY_MS,
  mergeEvent,
  openVisionStream,
  unacknowledgedCount,
  useVisionEvents,
  type StreamHandlers,
  type UseVisionEvents,
} from '@/view-models/use-vision-events';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { listCameraEvents: jest.fn(), acknowledgeCameraEvent: jest.fn(), streamVisionEvents: jest.fn() } };
});

const server = { hydrated: true };
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: server.hydrated }),
}));

const screen = { active: true };
jest.mock('../use-screen-active', () => ({ useScreenActive: () => screen.active }));

// The poll is `use-live.test.ts`'s business: here it is a read on mount while enabled.
const polling: boolean[] = [];
jest.mock('../use-live', () => ({
  useLive: (read: () => Promise<unknown>, _delay: unknown, enabled = true) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    polling.push(enabled);
    useEffect(() => {
      if (enabled) void read();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);
  },
}));

const pond = jest.mocked(api);

function event(over: Partial<CameraEvent> = {}): CameraEvent {
  return {
    id: 1,
    camera_id: 'camera-1',
    event_type: 'person',
    confidence: 0.94,
    snapshot_path: null,
    snapshot_url: null,
    metadata: null,
    acknowledged: false,
    created_at: '2026-10-19T08:00:01+00:00',
    ...over,
  };
}

const refusal = (status: number, body: unknown = null) => new ApiError(`GET /api/v1/camera/events → ${status}`, status, null, null, body);

/** A stream the test drives: open it, push events, end it. */
interface FakeStream {
  push: (e: CameraEvent) => void;
  end: () => void;
  fail: (e: unknown) => void;
}
let streams: FakeStream[] = [];

interface Mounted {
  readonly vm: UseVisionEvents;
  rerender: (cameraId: string | null) => Promise<void>;
  unmount: () => Promise<void>;
}

async function mount(cameraId: string | null): Promise<Mounted> {
  let latest!: UseVisionEvents;
  const Probe = ({ id }: { id: string | null }) => {
    latest = useVisionEvents(id);
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe id={cameraId} />);
  });
  return {
    get vm() {
      return latest;
    },
    rerender: async (id) => {
      await act(async () => tree.update(<Probe id={id} />));
    },
    unmount: async () => {
      await act(async () => tree.unmount());
    },
  };
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  resetSnackbar();
  jest.resetAllMocks();
  server.hydrated = true;
  screen.active = true;
  polling.length = 0;
  streams = [];
  pond.listCameraEvents.mockResolvedValue([]);
  pond.acknowledgeCameraEvent.mockResolvedValue(undefined);
  pond.streamVisionEvents.mockImplementation(
    (onEvent, signal, onOpen) =>
      new Promise<void>((resolve, reject) => {
        onOpen?.();
        streams.push({ push: onEvent, end: () => resolve(), fail: reject });
        signal?.addEventListener('abort', () => resolve());
      }),
  );
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('reading', () => {
  // The stream's catch-up read is `arrivals`' business; here the list is read by the poll alone.
  beforeEach(() => {
    screen.active = false;
  });

  it('asks for nothing until the settings name a camera', async () => {
    const m = await mount(null);
    expect(pond.listCameraEvents).not.toHaveBeenCalled();
    expect(pond.streamVisionEvents).not.toHaveBeenCalled();
    expect(m.vm.loading).toBe(true);
    await m.unmount();
  });

  it('reads the camera as soon as the settings name it', async () => {
    pond.listCameraEvents.mockResolvedValue([event({ id: 4 })]);
    const m = await mount(null);

    await m.rerender('camera-1');

    expect(pond.listCameraEvents).toHaveBeenCalledWith('camera-1', 100);
    expect(m.vm.data.events.map((e) => e.id)).toEqual([4]);
    expect(m.vm.loading).toBe(false);
    await m.unmount();
  });

  it('asks for nothing before the connection has hydrated', async () => {
    server.hydrated = false;
    const m = await mount('camera-1');
    expect(pond.listCameraEvents).not.toHaveBeenCalled();
    expect(pond.streamVisionEvents).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('lists the named camera and counts what is not acknowledged', async () => {
    pond.listCameraEvents.mockResolvedValue([event({ id: 1 }), event({ id: 2, acknowledged: true }), event({ id: 3 })]);
    const m = await mount('front-door');

    expect(pond.listCameraEvents).toHaveBeenCalledWith('front-door', 100);
    expect(m.vm.data.events.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(m.vm.data.unacknowledged).toBe(2);
    expect(m.vm.loading).toBe(false);
    expect(m.vm.failed).toBe(false);
    await m.unmount();
  });

  it('marks a first read that failed as unknown, not empty', async () => {
    pond.listCameraEvents.mockRejectedValue(refusal(500));
    const m = await mount('camera-1');

    expect(m.vm.failed).toBe(true);
    expect(m.vm.error).toBe('Your Pond is busy. Try again in a moment.');
    expect(m.vm.data.events).toEqual([]);
    await m.unmount();
  });

  it('starts over, and reads at once, when the camera is renamed', async () => {
    pond.listCameraEvents.mockResolvedValueOnce([event({ id: 1 })]).mockResolvedValueOnce([event({ id: 9, camera_id: 'garage' })]);
    const m = await mount('camera-1');
    expect(m.vm.data.events.map((e) => e.id)).toEqual([1]);

    await m.rerender('garage');

    expect(pond.listCameraEvents).toHaveBeenLastCalledWith('garage', 100);
    expect(m.vm.data.events.map((e) => e.id)).toEqual([9]);
    await m.unmount();
  });

  it('a refresh someone asked for reports its failure, and keeps the list', async () => {
    pond.listCameraEvents.mockResolvedValueOnce([event()]).mockRejectedValueOnce(refusal(500));
    const m = await mount('camera-1');

    await act(async () => m.vm.actions.refresh());

    expect(m.vm.error).toBe('Your Pond is busy. Try again in a moment.');
    expect(m.vm.failed).toBe(false);
    expect(m.vm.data.events).toHaveLength(1);
    await m.unmount();
  });
});

describe('acknowledging', () => {
  // The stream's catch-up read is `arrivals`' business; here the list is read by the poll alone.
  beforeEach(() => {
    screen.active = false;
  });

  it('sends the id, shows it acknowledged, and reads the list back', async () => {
    pond.listCameraEvents
      .mockResolvedValueOnce([event({ id: 7 })])
      .mockResolvedValueOnce([event({ id: 8 }), event({ id: 7, acknowledged: true })]);
    const m = await mount('camera-1');

    await act(async () => m.vm.actions.acknowledge(m.vm.data.events[0]));

    expect(pond.acknowledgeCameraEvent).toHaveBeenCalledWith(7);
    expect(pond.listCameraEvents).toHaveBeenCalledTimes(2);
    expect(m.vm.data.events.map((e) => [e.id, e.acknowledged])).toEqual([[8, false], [7, true]]);
    expect(m.vm.acknowledging.size).toBe(0);
    expect(m.vm.error).toBeNull();
    await m.unmount();
  });

  it('holds the button while the Pond answers', async () => {
    let finish!: () => void;
    pond.listCameraEvents.mockResolvedValue([event({ id: 7 })]);
    pond.acknowledgeCameraEvent.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const m = await mount('camera-1');

    let pending!: Promise<void>;
    await act(async () => {
      pending = m.vm.actions.acknowledge(m.vm.data.events[0]);
    });
    expect(m.vm.acknowledging.has(7)).toBe(true);

    await act(async () => {
      finish();
      await pending;
    });
    expect(m.vm.acknowledging.has(7)).toBe(false);
    await m.unmount();
  });

  it('a refusal leaves the event new, and says so with Try again', async () => {
    pond.listCameraEvents.mockResolvedValue([event({ id: 7 })]);
    pond.acknowledgeCameraEvent.mockRejectedValue(new TypeError('Network request failed'));
    const m = await mount('camera-1');

    await act(async () => m.vm.actions.acknowledge(m.vm.data.events[0]));

    expect(m.vm.data.events[0].acknowledged).toBe(false);
    expect(m.vm.error).toBeNull();
    expect(currentSnackbar()).toMatchObject({ tone: 'danger', message: 'Could not acknowledge that event.' });
    expect(pond.listCameraEvents).toHaveBeenCalledTimes(1);

    pond.acknowledgeCameraEvent.mockResolvedValue();
    await act(async () => currentSnackbar()?.action?.onPress());
    expect(pond.acknowledgeCameraEvent).toHaveBeenCalledTimes(2);
    await m.unmount();
  });
});

describe('filters', () => {
  // The stream's catch-up read is `arrivals`' business; here the list is read by the poll alone.
  beforeEach(() => {
    screen.active = false;
  });

  it('narrows what is shown without losing what was read', async () => {
    pond.listCameraEvents.mockResolvedValue([
      event({ id: 1 }),
      event({ id: 2, event_type: 'package' }),
      event({ id: 3, event_type: 'person', metadata: { face_detected: true, face_unknown: true } }),
    ]);
    const m = await mount('camera-1');
    expect(m.vm.data.shown.map((e) => e.id)).toEqual([1, 2, 3]);

    await act(async () => m.vm.actions.setFilter('unknownFaces'));
    expect(m.vm.data.shown.map((e) => e.id)).toEqual([3]);
    expect(m.vm.data.events).toHaveLength(3);
    expect(m.vm.data.unacknowledged).toBe(3);

    await act(async () => m.vm.actions.setFilter('packages'));
    expect(m.vm.data.shown.map((e) => e.id)).toEqual([2]);

    await act(async () => m.vm.actions.setFilter('all'));
    expect(m.vm.data.shown).toHaveLength(3);
    await m.unmount();
  });
});

describe('arrivals', () => {
  beforeEach(() => {
    pond.listCameraEvents.mockResolvedValue([event({ id: 1 })]);
  });

  it('opens the stream once the camera is known, the connection has hydrated and the screen is in front', async () => {
    const m = await mount('camera-1');
    expect(pond.streamVisionEvents).toHaveBeenCalledTimes(1);
    expect(m.vm.live).toBe(true);
    await m.unmount();
  });

  it('does not open it while the screen is behind another or the app is in the background', async () => {
    screen.active = false;
    const m = await mount('camera-1');
    expect(pond.streamVisionEvents).not.toHaveBeenCalled();
    expect(m.vm.live).toBe(false);
    await m.unmount();
  });

  it('closes it when the screen goes away', async () => {
    const m = await mount('camera-1');
    let aborted = false;
    pond.streamVisionEvents.mock.calls[0][1]?.addEventListener('abort', () => (aborted = true));

    await m.unmount();

    expect(aborted).toBe(true);
  });

  it('puts an arriving event at the top, with no read', async () => {
    const m = await mount('camera-1');
    pond.listCameraEvents.mockClear();

    await act(async () => streams[0].push(event({ id: 2, event_type: 'package' })));

    expect(m.vm.data.events.map((e) => e.id)).toEqual([2, 1]);
    expect(m.vm.data.unacknowledged).toBe(2);
    expect(pond.listCameraEvents).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('does not list an event twice, nor one from another camera', async () => {
    const m = await mount('camera-1');

    await act(async () => {
      streams[0].push(event({ id: 1 }));
      streams[0].push(event({ id: 5, camera_id: 'garage' }));
    });

    expect(m.vm.data.events.map((e) => e.id)).toEqual([1]);
    await m.unmount();
  });

  it('keeps an arrival that lands while a read is out', async () => {
    let answer!: (list: CameraEvent[]) => void;
    const m = await mount('camera-1');
    pond.listCameraEvents.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));

    let reading!: Promise<void>;
    await act(async () => {
      reading = m.vm.actions.refresh();
    });
    await act(async () => streams[0].push(event({ id: 2 })));
    await act(async () => {
      answer([event({ id: 1 })]);
      await reading;
    });

    expect(m.vm.data.events.map((e) => e.id)).toEqual([2, 1]);
    await m.unmount();
  });

  it('reads the poll no more once the stream is open, and reads the list once to catch up', async () => {
    const m = await mount('camera-1');

    expect(m.vm.live).toBe(true);
    expect(polling.at(-1)).toBe(false);
    // One read before the stream opened (the poll), one when it did.
    expect(pond.listCameraEvents).toHaveBeenCalledTimes(2);
    await m.unmount();
  });

  it('is back on the poll when the stream ends, and says it is no longer live', async () => {
    const m = await mount('camera-1');

    await act(async () => streams[0].end());

    expect(m.vm.live).toBe(false);
    expect(polling.at(-1)).toBe(true);
    await m.unmount();
  });

  it('is on the poll alone for a Pond with no stream, and does not ask again', async () => {
    jest.useFakeTimers();
    pond.streamVisionEvents.mockRejectedValue(refusal(404));
    const m = await mount('camera-1');

    await act(async () => jest.advanceTimersByTimeAsync(STREAM_RETRY_MAX_MS * 2));

    expect(pond.streamVisionEvents).toHaveBeenCalledTimes(1);
    expect(m.vm.live).toBe(false);
    // The poll has the list.
    expect(m.vm.data.events.map((e) => e.id)).toEqual([1]);
    await m.unmount();
    jest.useRealTimers();
  });

  it('says so when Privacy refuses the stream, and clears it once cameras are back', async () => {
    jest.useFakeTimers();
    pond.streamVisionEvents.mockRejectedValueOnce(refusal(403, { error: 'off', reason: 'cameras_disabled' }));
    const m = await mount('camera-1');
    expect(m.vm.streamBlocked).toBe(true);
    expect(m.vm.live).toBe(false);

    await act(async () => jest.advanceTimersByTimeAsync(STREAM_RETRY_MAX_MS));

    expect(m.vm.streamBlocked).toBe(false);
    expect(m.vm.live).toBe(true);
    await m.unmount();
    jest.useRealTimers();
  });
});

describe('keeping the stream open', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const handlers = (): StreamHandlers & { live: boolean[]; blocked: boolean[] } => {
    const live: boolean[] = [];
    const blocked: boolean[] = [];
    return { onEvent: jest.fn(), onLive: (v) => live.push(v), onBlocked: (v) => blocked.push(v), live, blocked };
  };

  it('comes back quickly when a stream that was open drops', async () => {
    const h = handlers();
    const stop = openVisionStream(h);
    await jest.advanceTimersByTimeAsync(0);
    streams[0].end();
    await jest.advanceTimersByTimeAsync(STREAM_RETRY_MS - 1);
    expect(pond.streamVisionEvents).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(pond.streamVisionEvents).toHaveBeenCalledTimes(2);
    expect(h.live).toEqual([true, false, true]);
    stop();
  });

  it('waits longer each time a stream never opens, up to a ceiling', async () => {
    pond.streamVisionEvents.mockRejectedValue(refusal(503));
    const stop = openVisionStream(handlers());
    await jest.advanceTimersByTimeAsync(0);
    const waits: number[] = [];
    let calls = pond.streamVisionEvents.mock.calls.length;
    for (let elapsed = 1; elapsed < 200_000 && waits.length < 8; elapsed++) {
      await jest.advanceTimersByTimeAsync(500);
      if (pond.streamVisionEvents.mock.calls.length > calls) {
        waits.push(elapsed * 500);
        calls = pond.streamVisionEvents.mock.calls.length;
        elapsed = 0;
      }
    }
    expect(waits.slice(0, 5)).toEqual([2000, 4000, 8000, 16000, 32000]);
    expect(Math.max(...waits)).toBeLessThanOrEqual(STREAM_RETRY_MAX_MS);
    stop();
  });

  it('is quiet once stopped, and leaves nothing scheduled', async () => {
    pond.streamVisionEvents.mockRejectedValue(refusal(503));
    const h = handlers();
    const stop = openVisionStream(h);
    await jest.advanceTimersByTimeAsync(0);
    stop();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(STREAM_RETRY_MAX_MS * 2);
    expect(pond.streamVisionEvents).toHaveBeenCalledTimes(1);
  });
});

describe('merging an arrival', () => {
  it('puts it first and keeps what the list already knows about one it holds', () => {
    const held = event({ id: 1, acknowledged: true });
    expect(mergeEvent([held], event({ id: 1, acknowledged: false }))[0].acknowledged).toBe(true);
    expect(mergeEvent([held], event({ id: 2 })).map((e) => e.id)).toEqual([2, 1]);
  });

  it('holds no more than the Pond gives', () => {
    const list = Array.from({ length: 100 }, (_, i) => event({ id: i + 1 }));
    expect(mergeEvent(list, event({ id: 500 }))).toHaveLength(100);
    expect(mergeEvent(list, event({ id: 500 }))[0].id).toBe(500);
  });

  it('counts the unacknowledged', () => {
    expect(unacknowledgedCount([event(), event({ acknowledged: true })])).toBe(1);
  });
});
