/**
 * The status card's view-model: what the pipeline says it is doing, and the frame read only while
 * there is a picture to read.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import type { VisionState, VisionStatus } from '@/services/types';
import { FRAME_MISSES_BEFORE_STALE, useVisionStatus, type UseVisionStatus } from '@/view-models/use-vision-status';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { visionStatus: jest.fn(), fetchImage: jest.fn(), cameraSnapshotPath: (id: string) => `/api/v1/camera/${id}/snapshot` } };
});

const server = { hydrated: true };
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: server.hydrated }),
}));

// Each poll is a read on mount while enabled, and the test makes the next one by hand.
const polls: { read: () => Promise<void>; delay: unknown; enabled: boolean; floor: unknown }[] = [];
jest.mock('../use-live', () => ({
  MIN_POLL_MS: 5000,
  LIVE_VIEW_POLL_MS: 1000,
  useLive: (read: () => Promise<unknown>, delay: unknown, enabled = true, floor?: unknown) => {
    const { useEffect, useRef } = jest.requireActual<typeof import('react')>('react');
    const latest = useRef(read);
    latest.current = read;
    const record = {
      read: async () => {
        await latest.current();
      },
      delay,
      enabled,
      floor,
    };
    polls.push(record);
    useEffect(() => {
      if (enabled) void latest.current();
    }, [enabled]);
  },
}));

const pond = jest.mocked(api);

const status = (state: VisionState = 'running', over: Partial<VisionStatus> = {}): VisionStatus => ({
  cameras_enabled: state !== 'consent_off',
  vision_enabled: state !== 'off',
  state,
  camera_id: 'camera-1',
  source: '/dev/video0',
  source_kind: 'discovered',
  fps: 1,
  last_frame_at: '2026-10-26T12:00:01Z',
  last_event_at: null,
  last_error: null,
  restarts: 0,
  classifier: { available: true },
  faces: { available: true, enrolled_people: 0 },
  event_listeners: 0,
  ...over,
});

const refusal = (statusCode: number, body: unknown = null) => new ApiError(`x → ${statusCode}`, statusCode, null, null, body);

const mounted: ReactTestRenderer[] = [];

async function mount(wantFrame = true): Promise<{ readonly vm: UseVisionStatus; rerender: () => Promise<void> }> {
  let latest!: UseVisionStatus;
  const Probe = () => {
    latest = useVisionStatus(wantFrame);
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
    mounted.push(tree);
  });
  return {
    get vm() { return latest; },
    rerender: async () => act(async () => tree.update(<Probe />)),
  };
}

/** The frame poll is the one that asks for the live-view floor. */
const framePoll = () => polls.filter((p) => p.floor === 1000).at(-1);

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.resetAllMocks();
  polls.length = 0;
  server.hydrated = true;
  pond.visionStatus.mockResolvedValue(status());
  pond.fetchImage.mockResolvedValue('data:image/jpeg;base64,AAAA');
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  for (const tree of mounted.splice(0)) await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

describe('the status', () => {
  it('asks for nothing before the connection has hydrated', async () => {
    server.hydrated = false;
    await mount();
    expect(pond.visionStatus).not.toHaveBeenCalled();
    expect(pond.fetchImage).not.toHaveBeenCalled();
  });

  it('says what the pipeline is doing, in a sentence', async () => {
    const m = await mount();

    expect(m.vm.data.sentence?.sentence).toBe('Watching camera-1, 1 picture a second.');
    expect(m.vm.data.status?.state).toBe('running');
    expect(m.vm.loading).toBe(false);
  });

  it('polls at the app’s pace, not the picture’s', async () => {
    await mount();
    const status = polls.find((p) => p.floor === undefined);
    expect(status?.delay).toBe(5000);
  });

  it('marks a first read that failed as unknown, not as off', async () => {
    pond.visionStatus.mockRejectedValue(refusal(500));
    const m = await mount();

    expect(m.vm.failed).toBe(true);
    expect(m.vm.data.sentence).toBeNull();
    expect(m.vm.error).toBe('Your Pond is busy. Try again in a moment.');
  });

  it('keeps the last status when a later quiet read fails', async () => {
    const m = await mount();
    pond.visionStatus.mockRejectedValue(refusal(500));

    await act(async () => polls.find((p) => p.floor === undefined)!.read());

    expect(m.vm.data.sentence?.label).toBe('Live');
    expect(m.vm.failed).toBe(false);
    expect(m.vm.error).toBeNull();
  });

  it('knows a pond that does not report it, which is not a failure', async () => {
    pond.visionStatus.mockRejectedValue(refusal(404));
    const m = await mount();

    expect(m.vm.unsupported).toBe(true);
    expect(m.vm.failed).toBe(false);
    expect(m.vm.error).toBeNull();
  });

  it('says the camera is held back by Privacy, as a reason to open Privacy', async () => {
    pond.visionStatus.mockResolvedValue(status('consent_off'));
    const m = await mount();

    expect(m.vm.data.sentence?.privacy).toBe(true);
  });
});

describe('the frame', () => {
  it('is read while the camera is running, from that camera’s snapshot route', async () => {
    const m = await mount();

    expect(pond.fetchImage).toHaveBeenCalledWith('/api/v1/camera/camera-1/snapshot');
    expect(m.vm.data.frame).toEqual({ uri: 'data:image/jpeg;base64,AAAA', stale: false, blocked: false });
  });

  it('is polled about once a second, and says so by the live-view floor', async () => {
    await mount();
    expect(framePoll()).toMatchObject({ delay: 1000, floor: 1000, enabled: true });
  });

  it.each<VisionState>(['off', 'consent_off', 'no_camera', 'starting', 'reconnecting'])(
    'is never read while the camera is %s',
    async (state) => {
      pond.visionStatus.mockResolvedValue(status(state));
      const m = await mount();

      expect(pond.fetchImage).not.toHaveBeenCalled();
      expect(framePoll()?.enabled).toBe(false);
      expect(m.vm.data.frame.uri).toBeNull();
    },
  );

  it('is not read by a screen that does not draw it', async () => {
    await mount(false);
    expect(pond.fetchImage).not.toHaveBeenCalled();
  });

  it('drops the picture the moment the camera stops running, rather than hold an old one behind "Live"', async () => {
    const m = await mount();
    expect(m.vm.data.frame.uri).not.toBeNull();

    pond.visionStatus.mockResolvedValue(status('reconnecting'));
    await act(async () => polls.find((p) => p.floor === undefined)!.read());

    expect(m.vm.data.frame.uri).toBeNull();
  });

  it('keeps the last picture through a miss, and calls it stale after several', async () => {
    const m = await mount();
    pond.fetchImage.mockRejectedValue(refusal(404));

    for (let i = 1; i < FRAME_MISSES_BEFORE_STALE; i++) {
      await act(async () => framePoll()!.read());
      expect(m.vm.data.frame.stale).toBe(false);
      expect(m.vm.data.frame.uri).not.toBeNull();
    }
    await act(async () => framePoll()!.read());
    expect(m.vm.data.frame.stale).toBe(true);

    pond.fetchImage.mockResolvedValue('data:image/jpeg;base64,BBBB');
    await act(async () => framePoll()!.read());
    expect(m.vm.data.frame).toEqual({ uri: 'data:image/jpeg;base64,BBBB', stale: false, blocked: false });
  });

  it('says Privacy is what refuses, and not that pictures are not arriving', async () => {
    const m = await mount();
    pond.fetchImage.mockRejectedValue(refusal(403, { error: 'off', reason: 'cameras_disabled' }));

    await act(async () => framePoll()!.read());

    expect(m.vm.data.frame.blocked).toBe(true);
    expect(m.vm.data.frame.stale).toBe(false);
  });

  it('does not let a slow picture replace a newer one', async () => {
    const m = await mount();
    let late!: (uri: string) => void;
    pond.fetchImage.mockReturnValueOnce(new Promise((resolve) => (late = resolve)));
    pond.fetchImage.mockResolvedValueOnce('data:image/jpeg;base64,NEW');

    let slow!: Promise<unknown>;
    await act(async () => {
      slow = framePoll()!.read();
    });
    await act(async () => framePoll()!.read());
    expect(m.vm.data.frame.uri).toBe('data:image/jpeg;base64,NEW');

    await act(async () => {
      late('data:image/jpeg;base64,OLD');
      await slow;
    });
    expect(m.vm.data.frame.uri).toBe('data:image/jpeg;base64,NEW');
  });
});
