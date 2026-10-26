/**
 * The camera-events view-model and the words it is shown with: which camera it asks for, what a
 * failed read or acknowledgement leaves on screen, and that an acknowledgement is read back.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { describeConfidence, describeSeen } from '@/models/camera-events';
import { ApiError, api } from '@/services/api-client';
import type { CameraEvent } from '@/services/types';
import { unacknowledgedCount, useCameraEvents, type UseCameraEvents } from '@/view-models/use-camera-events';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { listCameraEvents: jest.fn(), acknowledgeCameraEvent: jest.fn() } };
});

const server = { hydrated: true };
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: server.hydrated }),
}));

// The poll is `use-live.test.ts`'s business: here it is a read on mount while enabled.
jest.mock('../use-live', () => ({
  useLive: (read: () => Promise<unknown>, _delay: unknown, enabled = true) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
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

const refusal = (status: number) => new ApiError(`GET /api/v1/camera/events → ${status}`, status, null, null);

interface Mounted {
  readonly vm: UseCameraEvents;
  rerender: (cameraId: string | null) => Promise<void>;
  unmount: () => Promise<void>;
}

async function mount(cameraId: string | null): Promise<Mounted> {
  let latest!: UseCameraEvents;
  const Probe = ({ id }: { id: string | null }) => {
    latest = useCameraEvents(id);
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
  jest.resetAllMocks();
  server.hydrated = true;
  pond.listCameraEvents.mockResolvedValue([]);
  pond.acknowledgeCameraEvent.mockResolvedValue(undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('reading', () => {
  it('asks for nothing until the settings name a camera', async () => {
    const m = await mount(null);
    expect(pond.listCameraEvents).not.toHaveBeenCalled();
    expect(m.vm.loading).toBe(true);
    await m.unmount();
  });

  it('reads the camera as soon as the settings name it', async () => {
    pond.listCameraEvents.mockResolvedValue([event({ id: 4 })]);
    const m = await mount(null);

    await m.rerender('camera-1');

    expect(pond.listCameraEvents).toHaveBeenCalledTimes(1);
    expect(pond.listCameraEvents).toHaveBeenCalledWith('camera-1', 50);
    expect(m.vm.data.events.map((e) => e.id)).toEqual([4]);
    expect(m.vm.loading).toBe(false);
    await m.unmount();
  });

  it('asks for nothing before the connection has hydrated', async () => {
    server.hydrated = false;
    const m = await mount('camera-1');
    expect(pond.listCameraEvents).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('lists the named camera and counts what is not acknowledged', async () => {
    pond.listCameraEvents.mockResolvedValue([event({ id: 1 }), event({ id: 2, acknowledged: true }), event({ id: 3 })]);
    const m = await mount('front-door');

    expect(pond.listCameraEvents).toHaveBeenCalledWith('front-door', 50);
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

    expect(pond.listCameraEvents).toHaveBeenLastCalledWith('garage', 50);
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

  it('a refusal leaves the event new, says so, and is not wiped by a read-back', async () => {
    pond.listCameraEvents.mockResolvedValue([event({ id: 7 })]);
    pond.acknowledgeCameraEvent.mockRejectedValue(new TypeError('Network request failed'));
    const m = await mount('camera-1');

    await act(async () => m.vm.actions.acknowledge(m.vm.data.events[0]));

    expect(m.vm.data.events[0].acknowledged).toBe(false);
    expect(m.vm.error).toBe('Could not acknowledge that event. Try again.');
    expect(pond.listCameraEvents).toHaveBeenCalledTimes(1);
    await m.unmount();
  });
});

describe('the words', () => {
  it('names the kinds the Pond documents, and shows any other as the Pond wrote it', () => {
    expect(describeSeen({ event_type: 'person' })).toBe('A person');
    expect(describeSeen({ event_type: 'motion' })).toBe('Movement');
    expect(describeSeen({ event_type: 'vehicle' })).toBe('A vehicle');
    expect(describeSeen({ event_type: 'raccoon' })).toBe('raccoon');
    expect(describeSeen({ event_type: '  ' })).toBe('Something');
  });

  it('says how sure, and nothing for an event with no score', () => {
    expect(describeConfidence({ confidence: 0.944 })).toBe('94% sure');
    expect(describeConfidence({ confidence: 1.2 })).toBe('100% sure');
    expect(describeConfidence({ confidence: null })).toBeNull();
  });

  it('counts the unacknowledged', () => {
    expect(unacknowledgedCount([event(), event({ acknowledged: true })])).toBe(1);
  });
});
