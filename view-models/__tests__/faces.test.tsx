/**
 * The Faces view-model: who the pond knows by sight, naming a person from their profile id, and
 * what each way of teaching the pond a face, or making it forget, comes to.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import { AttachError, pickAttachments } from '@/services/media';
import type { FaceOverview, FacePerson } from '@/services/types';
import { describeFaceError, useFaceEnrolment, useFaces, type UseFaceEnrolment, type UseFaces } from '@/view-models/use-faces';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      listFaces: jest.fn(),
      listProfiles: jest.fn(),
      forgetFace: jest.fn(),
      setFaceThreshold: jest.fn(),
      clearFaceThreshold: jest.fn(),
      registerFaceFromCamera: jest.fn(),
      registerFacePhoto: jest.fn(),
    },
  };
});
jest.mock('@/services/media', () => {
  const actual = jest.requireActual('@/services/media');
  return { ...actual, pickAttachments: jest.fn() };
});

const server = { hydrated: true };
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: server.hydrated }),
}));

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
const pick = jest.mocked(pickAttachments);

const person = (over: Partial<FacePerson> = {}): FacePerson => ({
  profile_id: 'amina',
  name: 'Amina',
  enrollments: 4,
  threshold: null,
  last_enrolled_at: null,
  ...over,
});

const overview = (over: Partial<FaceOverview> = {}): FaceOverview => ({
  available: true,
  default_threshold: 0.45,
  people: [person({ profile_id: 'zawadi', name: 'Zawadi', enrollments: 0 }), person()],
  ...over,
});

const refusal = (status: number, body: unknown = null) => new ApiError(`x → ${status}`, status, null, null, body);

const mounted: ReactTestRenderer[] = [];

async function mountFaces(): Promise<{ readonly vm: UseFaces }> {
  let latest!: UseFaces;
  const Probe = () => {
    latest = useFaces();
    return null;
  };
  await act(async () => {
    mounted.push(create(<Probe />));
  });
  return { get vm() { return latest; } };
}

async function mountEnrolment(onAdded: () => Promise<void>): Promise<{ readonly vm: UseFaceEnrolment }> {
  let latest!: UseFaceEnrolment;
  const Probe = () => {
    latest = useFaceEnrolment(onAdded);
    return null;
  };
  await act(async () => {
    mounted.push(create(<Probe />));
  });
  return { get vm() { return latest; } };
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.resetAllMocks();
  server.hydrated = true;
  pond.listFaces.mockResolvedValue(overview());
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  for (const tree of mounted.splice(0)) await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

describe('reading', () => {
  it('asks for nothing before the connection has hydrated', async () => {
    server.hydrated = false;
    await mountFaces();
    expect(pond.listFaces).not.toHaveBeenCalled();
  });

  it('lists the household with the people the pond knows first, and counts them', async () => {
    const m = await mountFaces();

    expect(m.vm.data.people.map((p) => p.name)).toEqual(['Amina', 'Zawadi']);
    expect(m.vm.data.known).toBe(1);
    expect(m.vm.data.available).toBe(true);
    expect(m.vm.data.defaultThreshold).toBe(0.45);
    expect(m.vm.loading).toBe(false);
  });

  it('names a person from their profile id, and no one else', async () => {
    const m = await mountFaces();

    expect(m.vm.nameOf('amina')).toBe('Amina');
    expect(m.vm.nameOf('gone')).toBeNull();
  });

  it('marks a first read that failed as unknown, not as nobody', async () => {
    pond.listFaces.mockRejectedValue(refusal(500));
    const m = await mountFaces();

    expect(m.vm.failed).toBe(true);
    expect(m.vm.error).toBe('Your Pond is busy. Try again in a moment.');
  });

  it('keeps the last list when a quiet refresh fails', async () => {
    const m = await mountFaces();
    pond.listFaces.mockRejectedValue(refusal(500));

    await act(async () => m.vm.actions.refresh());

    expect(m.vm.data.people).toHaveLength(2);
    expect(m.vm.failed).toBe(false);
    expect(m.vm.error).toBe('Your Pond is busy. Try again in a moment.');
  });

  it('reports a pond with no face model as unavailable, naming the household from its profiles', async () => {
    pond.listFaces.mockResolvedValue(overview({ available: false, people: [] }));
    pond.listProfiles.mockResolvedValue([{ id: 'amina', display_name: 'Amina', avatar_emoji: '' }]);
    const m = await mountFaces();

    expect(m.vm.data.available).toBe(false);
    expect(m.vm.data.people).toEqual([person({ enrollments: 0 })]);
    expect(m.vm.nameOf('amina')).toBe('Amina');
  });

  it('reads an older pond with no overview from its profiles', async () => {
    pond.listFaces.mockRejectedValue(refusal(404));
    pond.listProfiles.mockResolvedValue([{ id: 'baraka', display_name: 'Baraka', avatar_emoji: '' }]);
    const m = await mountFaces();

    expect(m.vm.data.available).toBe(false);
    expect(m.vm.nameOf('baraka')).toBe('Baraka');
    expect(m.vm.failed).toBe(false);
  });

  it('is not the profiles’ business when the pond can say who it knows', async () => {
    await mountFaces();
    expect(pond.listProfiles).not.toHaveBeenCalled();
  });
});

describe('forgetting a face', () => {
  it('asks the pond to, then reads the list back', async () => {
    pond.forgetFace.mockResolvedValue({ profile_id: 'amina', face_embeddings_deleted: 4 });
    const m = await mountFaces();
    pond.listFaces.mockResolvedValue(overview({ people: [person({ enrollments: 0 })] }));

    let refused: string | null = 'unset';
    await act(async () => {
      refused = await m.vm.actions.forget(person());
    });

    expect(pond.forgetFace).toHaveBeenCalledWith('amina');
    expect(refused).toBeNull();
    expect(m.vm.data.known).toBe(0);
  });

  it('says why the pond refused, and does not read the list back', async () => {
    pond.forgetFace.mockRejectedValue(refusal(503));
    const m = await mountFaces();
    pond.listFaces.mockClear();

    let refused: string | null = null;
    await act(async () => {
      refused = await m.vm.actions.forget(person());
    });

    expect(refused).toBe('Your Pond is busy. Try again in a moment.');
    expect(pond.listFaces).not.toHaveBeenCalled();
  });

  it('has a sentence for a refusal the shared reading leaves to the banner', async () => {
    pond.forgetFace.mockRejectedValue(refusal(403));
    const m = await mountFaces();

    let refused: string | null = null;
    await act(async () => {
      refused = await m.vm.actions.forget(person());
    });

    expect(refused).toBe('Your Pond could not forget that face. Try again.');
  });
});

describe('strictness', () => {
  it('sets one person’s own, and reads the list back', async () => {
    pond.setFaceThreshold.mockResolvedValue({ profile_id: 'amina', threshold: 0.6 });
    const m = await mountFaces();

    let refused: string | null = 'unset';
    await act(async () => {
      refused = await m.vm.actions.setStrictness(person(), 0.6);
    });

    expect(pond.setFaceThreshold).toHaveBeenCalledWith('amina', 0.6);
    expect(refused).toBeNull();
  });

  it('goes back to the pond’s own with null, by clearing rather than setting', async () => {
    pond.clearFaceThreshold.mockResolvedValue({ profile_id: 'amina', threshold: null });
    const m = await mountFaces();

    await act(async () => {
      await m.vm.actions.setStrictness(person({ threshold: 0.6 }), null);
    });

    expect(pond.clearFaceThreshold).toHaveBeenCalledWith('amina');
    expect(pond.setFaceThreshold).not.toHaveBeenCalled();
  });

  it('says so when the pond would not keep it', async () => {
    pond.setFaceThreshold.mockRejectedValue(refusal(400));
    const m = await mountFaces();

    let refused: string | null = null;
    await act(async () => {
      refused = await m.vm.actions.setStrictness(person(), 2);
    });

    expect(refused).toBe('Your Pond could not complete that request.');
  });
});

describe('the words for a refused sample', () => {
  const camera = (status: number, reason?: string) => describeFaceError(refusal(status, reason ? { reason } : null), 'camera');

  it('says what to do for each reason the pond gives from its camera', () => {
    expect(camera(409, 'no_frame')).toBe(
      "Your Pond's camera has not shown it a picture yet. Check that the camera is on, then try again in a moment.",
    );
    expect(camera(422, 'no_face')).toContain("can't see a face");
    expect(camera(403, 'cameras_disabled')).toBe("Cameras are switched off in Privacy, so your Pond can't take a picture.");
  });

  it('says a person is gone, and that face recognition is not there', () => {
    expect(camera(404)).toBe("Your Pond doesn't have that person any more. Go back and refresh the list.");
    expect(camera(503)).toBe("Face recognition isn't set up on your Pond.");
  });

  it('tells a photo it could not use from a camera that saw no face', () => {
    expect(describeFaceError(refusal(422), 'photo')).toContain('usable face in that photo');
    expect(describeFaceError(refusal(422), 'camera')).toContain("can't see a face");
  });

  it('falls back to a sentence for anything else, a dropped connection included', () => {
    expect(describeFaceError(new TypeError('Network request failed'), 'camera')).toBe(
      'Your Pond could not take that sample. Try again in a moment.',
    );
    expect(describeFaceError(new TypeError('Network request failed'), 'photo')).toBe(
      'Your Pond could not use that photo. Try again in a moment.',
    );
  });
});

describe('taking a sample at the pond’s camera', () => {
  it('names the camera it was looking at, says how many there are now, and reads the list back', async () => {
    pond.registerFaceFromCamera.mockResolvedValue({ id: 9, profile_id: 'amina', model_dims: 512, created_at: 't' });
    const added = jest.fn().mockResolvedValue(undefined);
    const m = await mountEnrolment(added);

    await act(async () => m.vm.actions.fromCamera(person({ enrollments: 2 }), 'camera-1'));

    expect(pond.registerFaceFromCamera).toHaveBeenCalledWith('amina', 'camera-1');
    expect(m.vm.notice).toEqual({ tone: 'success', text: 'Sample added. Amina now has 3 samples.', via: 'camera' });
    expect(added).toHaveBeenCalledTimes(1);
    expect(m.vm.busy).toBeNull();
  });

  it('says "1 sample" for the first', async () => {
    pond.registerFaceFromCamera.mockResolvedValue({ id: 1, profile_id: 'amina', model_dims: 512, created_at: 't' });
    const m = await mountEnrolment(jest.fn().mockResolvedValue(undefined));

    await act(async () => m.vm.actions.fromCamera(person({ enrollments: 0 }), null));

    expect(pond.registerFaceFromCamera).toHaveBeenCalledWith('amina', undefined);
    expect(m.vm.notice?.text).toBe('Sample added. Amina now has 1 sample.');
  });

  it('turns the pond’s reason into a sentence, and keeps the list as it was', async () => {
    pond.registerFaceFromCamera.mockRejectedValue(refusal(422, { reason: 'no_face' }));
    const added = jest.fn();
    const m = await mountEnrolment(added);

    await act(async () => m.vm.actions.fromCamera(person(), 'camera-1'));

    expect(m.vm.notice?.tone).toBe('danger');
    expect(m.vm.notice?.text).toContain("can't see a face");
    expect(added).not.toHaveBeenCalled();
  });

  it('holds still while the pond answers, so a second tap takes no second sample', async () => {
    let finish!: () => void;
    pond.registerFaceFromCamera.mockReturnValue(
      new Promise((resolve) => (finish = () => resolve({ id: 1, profile_id: 'amina', model_dims: 512, created_at: 't' }))),
    );
    const m = await mountEnrolment(jest.fn().mockResolvedValue(undefined));

    let first!: Promise<void>;
    await act(async () => {
      first = m.vm.actions.fromCamera(person(), 'camera-1');
    });
    expect(m.vm.busy).toBe('camera');
    await act(async () => m.vm.actions.fromCamera(person(), 'camera-1'));
    expect(pond.registerFaceFromCamera).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
      await first;
    });
    expect(m.vm.busy).toBeNull();
  });
});

describe('sending a photo from this phone', () => {
  const photo = { id: 'a', kind: 'image' as const, uri: 'file:///cache/face.jpg', name: 'face.jpg', mimeType: 'image/jpeg' };

  it('sends the picked JPEG to the pond for that person', async () => {
    pick.mockResolvedValue([photo]);
    pond.registerFacePhoto.mockResolvedValue({ id: 2, profile_id: 'amina', model_dims: 512, created_at: 't' });
    const added = jest.fn().mockResolvedValue(undefined);
    const m = await mountEnrolment(added);

    await act(async () => m.vm.actions.fromPhoto(person({ enrollments: 1 }), 'photos'));

    expect(pick).toHaveBeenCalledWith('photos', 1);
    expect(pond.registerFacePhoto).toHaveBeenCalledWith('amina', 'file:///cache/face.jpg');
    expect(m.vm.notice).toEqual({ tone: 'success', text: 'Sample added. Amina now has 2 samples.', via: 'photo' });
    expect(added).toHaveBeenCalled();
  });

  it('says nothing, and sends nothing, when the picker was closed without a choice', async () => {
    pick.mockResolvedValue([]);
    const m = await mountEnrolment(jest.fn());

    await act(async () => m.vm.actions.fromPhoto(person(), 'camera'));

    expect(pond.registerFacePhoto).not.toHaveBeenCalled();
    expect(m.vm.notice).toBeNull();
    expect(m.vm.busy).toBeNull();
  });

  it('says why a picker could not give a picture', async () => {
    pick.mockRejectedValue(new AttachError('chat.composer.cameraDenied'));
    const m = await mountEnrolment(jest.fn());

    await act(async () => m.vm.actions.fromPhoto(person(), 'camera'));

    expect(m.vm.notice).toEqual({
      tone: 'danger',
      text: 'Camera access is off for Goose On The Go. Turn it on in Settings to take a photo.',
      via: 'photo',
    });
  });

  it('says a photo with no usable face was not used', async () => {
    pick.mockResolvedValue([photo]);
    pond.registerFacePhoto.mockRejectedValue(refusal(422));
    const m = await mountEnrolment(jest.fn());

    await act(async () => m.vm.actions.fromPhoto(person(), 'photos'));

    expect(m.vm.notice?.text).toContain('usable face in that photo');
  });

  it('lets the notice go', async () => {
    pick.mockResolvedValue([photo]);
    pond.registerFacePhoto.mockRejectedValue(refusal(422));
    const m = await mountEnrolment(jest.fn());
    await act(async () => m.vm.actions.fromPhoto(person(), 'photos'));

    await act(async () => m.vm.actions.clear());

    expect(m.vm.notice).toBeNull();
  });
});
