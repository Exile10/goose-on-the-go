/**
 * Ideas from screenshots: the switch asks the Pond and nothing leaves while it is off, a picture
 * is shrunk before it goes and not kept after, and sending stops at the room the Pond has left or
 * when it says its queue is full.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { SHOT_MAX_CHARS, type ScreenshotNote, type Screenshots } from '@/models/screenshots';
import { ApiError, api } from '@/services/api-client';
import { currentSnackbar, resetSnackbar } from '@/services/snackbar';
import { useScreenshots, type UseScreenshots } from '@/view-models/use-screenshots';

const mockDeleted: string[] = [];

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return !mockDeleted.includes(this.uri);
    }
    delete() {
      mockDeleted.push(this.uri);
    }
  },
}));
jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/secure-random', () => ({ randomBytes: (n: number) => new Uint8Array(n).fill(7) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      screenshots: jest.fn(),
      setScreenshots: jest.fn(),
      sendScreenshot: jest.fn(),
      deleteScreenshotNote: jest.fn(),
      deleteAllScreenshotNotes: jest.fn(),
    },
  };
});
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true, isScreenReal: () => true }) }));

// The poll is `use-live.test.ts`'s business; here a loop is one read each time it is switched on.
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
const library = (jest.requireMock('expo-image-picker') as { launchImageLibraryAsync: jest.Mock }).launchImageLibraryAsync;
const manipulate = (jest.requireMock('expo-image-manipulator') as { ImageManipulator: { manipulate: jest.Mock } }).ImageManipulator.manipulate;

function note(id: string, usedAt: string | null = null): ScreenshotNote {
  return { id, note: `Looking at ${id}`, takenAt: null, createdAt: '2026-11-03T10:00:00+00:00', usedAt };
}

/** What the Pond holds: the reads answer with it, and a send or the switch changes it. */
let held: Screenshots;
/** What each picture re-encodes to, by the uri the picker gave; anything else is a few bytes. */
let encoded: Record<string, string>;
let resizes: { uri: string; size: { width: number; height: number } }[];
let saves: unknown[];

function shot(name: string, width = 1179, height = 2556) {
  return { uri: `file:///cache/ImagePicker/${name}.png`, width, height };
}

function chosen(...assets: { uri: string; width: number; height: number }[]) {
  library.mockResolvedValue({ canceled: false, assets });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets a chain of awaits that is not being waited on run as far as it can. */
const settle = () => act(async () => new Promise<void>((done) => setTimeout(done, 0)));

async function mount(): Promise<{ readonly vm: UseScreenshots; unmount: () => Promise<void> }> {
  let latest!: UseScreenshots;
  const Probe = () => {
    latest = useScreenshots();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  return {
    get vm() {
      return latest;
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
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockDeleted.length = 0;
  encoded = {};
  resizes = [];
  saves = [];
  held = { enabled: true, available: true, pending: 0, maxPending: 6, notes: [note('n1'), note('n2', '2026-11-04T10:00:00+00:00'), note('n3')] };

  pond.screenshots.mockImplementation(async () => held);
  pond.setScreenshots.mockImplementation(async (enabled) => {
    held = { ...held, enabled, pending: enabled ? held.pending : 0 };
    return held;
  });
  pond.sendScreenshot.mockImplementation(async () => {
    held = { ...held, pending: held.pending + 1 };
    return held.pending;
  });
  pond.deleteScreenshotNote.mockResolvedValue(undefined);
  pond.deleteAllScreenshotNotes.mockResolvedValue(undefined);

  manipulate.mockImplementation((uri: string) => {
    const image = {
      width: 1179,
      height: 2556,
      saveAsync: async (options: unknown) => {
        saves.push(options);
        return { uri: uri.replace('ImagePicker', 'ImageManipulator').replace('.png', '.jpg'), width: 590, height: 1280, base64: encoded[uri] ?? 'QUJD' };
      },
      release: jest.fn(),
    };
    const context = { resize: jest.fn(), renderAsync: async () => image, release: jest.fn() };
    context.resize.mockImplementation((size: { width: number; height: number }) => {
      resizes.push({ uri, size });
      return context;
    });
    return context;
  });
});

afterEach(() => jest.restoreAllMocks());

describe('the switch', () => {
  it('asks the Pond to turn it on and says so', async () => {
    held = { ...held, enabled: false };
    const m = await mount();
    expect(m.vm.data.enabled).toBe(false);

    await act(async () => {
      await m.vm.actions.setEnabled(true);
    });

    expect(pond.setScreenshots).toHaveBeenCalledWith(true);
    expect(m.vm.data.enabled).toBe(true);
    expect(currentSnackbar()).toMatchObject({ message: 'On. Choose screenshots to send.', tone: 'success' });
    await m.unmount();
  });

  it('shows the switch moved while the Pond answers, and puts it back when the Pond refuses', async () => {
    held = { ...held, enabled: false };
    const gate = deferred<Screenshots>();
    pond.setScreenshots.mockReturnValue(gate.promise);
    chosen(shot('a'));
    const m = await mount();

    let done!: Promise<void>;
    await act(async () => {
      done = m.vm.actions.setEnabled(true);
    });
    expect(m.vm.data.enabled).toBe(true);
    expect(m.vm.toggling).toBe(true);

    // Shown as on, and the Pond has not agreed yet: nothing may leave.
    await act(async () => {
      await m.vm.actions.choose();
    });
    expect(library).not.toHaveBeenCalled();

    await act(async () => {
      gate.reject(new ApiError('PUT → 500', 500, null));
      await done;
    });
    expect(m.vm.data.enabled).toBe(false);
    expect(m.vm.toggling).toBe(false);
    expect(currentSnackbar()).toMatchObject({ message: 'Your Pond is busy right now.', tone: 'danger' });
    await m.unmount();
  });

  it('asks the Pond to turn it off, which drops what was waiting', async () => {
    held = { ...held, pending: 2 };
    const m = await mount();

    await act(async () => {
      await m.vm.actions.setEnabled(false);
    });

    expect(pond.setScreenshots).toHaveBeenCalledWith(false);
    expect(m.vm.data).toMatchObject({ enabled: false, pending: 0 });
    expect(currentSnackbar()).toMatchObject({ message: 'Off. Screenshots still waiting were dropped.', tone: 'success' });
    await m.unmount();
  });

  it('turns nothing on where the Pond’s model cannot read pictures', async () => {
    held = { ...held, enabled: false, available: false };
    const m = await mount();

    await act(async () => {
      await m.vm.actions.setEnabled(true);
    });

    expect(pond.setScreenshots).not.toHaveBeenCalled();
    expect(m.vm.data.enabled).toBe(false);
    await m.unmount();
  });
});

describe('while it is off', () => {
  it('never opens the library or sends a picture', async () => {
    held = { ...held, enabled: false };
    chosen(shot('a'));
    const m = await mount();

    await act(async () => {
      await m.vm.actions.choose();
    });

    expect(library).not.toHaveBeenCalled();
    expect(pond.sendScreenshot).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('sends nothing after it is turned off', async () => {
    chosen(shot('a'));
    const m = await mount();
    await act(async () => {
      await m.vm.actions.setEnabled(false);
    });

    await act(async () => {
      await m.vm.actions.choose();
    });

    expect(library).not.toHaveBeenCalled();
    expect(pond.sendScreenshot).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('stops sending the moment it is turned off, with pictures still to go', async () => {
    const first = deferred<number>();
    pond.sendScreenshot.mockReturnValueOnce(first.promise);
    chosen(shot('a'), shot('b'), shot('c'));
    const m = await mount();

    let sending!: Promise<void>;
    await act(async () => {
      sending = m.vm.actions.choose();
    });
    await settle();
    expect(pond.sendScreenshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      await m.vm.actions.setEnabled(false);
    });
    await act(async () => {
      first.resolve(1);
      await sending;
    });

    expect(pond.sendScreenshot).toHaveBeenCalledTimes(1);
    expect(mockDeleted).toEqual(expect.arrayContaining([shot('b').uri, shot('c').uri]));
    await m.unmount();
  });
});

describe('sending', () => {
  it('opens the library for pictures only, as many as there is room for', async () => {
    held = { ...held, pending: 2 };
    library.mockResolvedValue({ canceled: true, assets: null });
    const m = await mount();

    await act(async () => {
      await m.vm.actions.choose();
    });

    expect(library).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 4, exif: false }));
    expect(pond.sendScreenshot).not.toHaveBeenCalled();
    expect(m.vm.sent).toBeNull();
    expect(currentSnackbar()).toBeNull();
    await m.unmount();
  });

  it('shrinks each picture to a JPEG and sends it, then keeps neither copy', async () => {
    encoded = { [shot('a').uri]: 'AAAA', [shot('b').uri]: 'BBBB' };
    chosen(shot('a'), shot('b', 800, 600));
    const m = await mount();

    await act(async () => {
      await m.vm.actions.choose();
    });

    expect(resizes).toEqual([{ uri: shot('a').uri, size: { width: 590, height: 1280 } }]);
    expect(saves).toEqual([
      { format: 'jpeg', compress: 0.7, base64: true },
      { format: 'jpeg', compress: 0.7, base64: true },
    ]);
    expect(pond.sendScreenshot.mock.calls).toEqual([
      ['AAAA', 'image/jpeg'],
      ['BBBB', 'image/jpeg'],
    ]);
    expect(m.vm.sent).toBe(2);
    expect(m.vm.sending).toBe(false);
    expect(m.vm.data.pending).toBe(2);
    expect(m.vm.room).toBe(4);
    expect([...mockDeleted].sort()).toEqual(
      ['file:///cache/ImageManipulator/a.jpg', 'file:///cache/ImageManipulator/b.jpg', 'file:///cache/ImagePicker/a.png', 'file:///cache/ImagePicker/b.png'].sort(),
    );
    await m.unmount();
  });

  it('never deletes a picture that is not the app’s own copy', async () => {
    const original = { uri: 'content://media/external/images/41', width: 600, height: 800 };
    chosen(original);
    const m = await mount();

    await act(async () => {
      await m.vm.actions.choose();
    });

    expect(pond.sendScreenshot).toHaveBeenCalledTimes(1);
    expect(mockDeleted).not.toContain(original.uri);
    await m.unmount();
  });

  it('stops at the room the Pond has left, and keeps none of the rest', async () => {
    held = { ...held, pending: 4 };
    chosen(shot('a'), shot('b'), shot('c'));
    const m = await mount();

    await act(async () => {
      await m.vm.actions.choose();
    });

    expect(library).toHaveBeenCalledWith(expect.objectContaining({ selectionLimit: 2 }));
    expect(pond.sendScreenshot).toHaveBeenCalledTimes(2);
    expect(m.vm.sent).toBe(2);
    expect(m.vm.data.pending).toBe(6);
    expect(m.vm.room).toBe(0);
    expect(mockDeleted).toContain(shot('c').uri);
    await m.unmount();
  });

  it('opens nothing when the Pond has no room at all', async () => {
    held = { ...held, pending: 6 };
    chosen(shot('a'));
    const m = await mount();

    await act(async () => {
      await m.vm.actions.choose();
    });

    expect(library).not.toHaveBeenCalled();
    expect(pond.sendScreenshot).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('stops when the Pond says its queue is full, and shows it full', async () => {
    held = { ...held, pending: 3 };
    pond.sendScreenshot.mockImplementation(async () => {
      if (held.pending >= held.maxPending) throw new ApiError('POST → 429', 429, 30);
      held = { ...held, pending: held.pending + 1 };
      return held.pending;
    });
    chosen(shot('a'), shot('b'), shot('c'));
    const m = await mount();
    // Another phone sent two since this one last read: there is less room than it thinks.
    held = { ...held, pending: 5 };

    await act(async () => {
      await m.vm.actions.choose();
    });

    expect(library).toHaveBeenCalledWith(expect.objectContaining({ selectionLimit: 3 }));
    expect(pond.sendScreenshot).toHaveBeenCalledTimes(2);
    expect(m.vm.sent).toBe(1);
    expect(m.vm.data.pending).toBe(6);
    expect(m.vm.room).toBe(0);
    expect(currentSnackbar()).toBeNull();
    expect(mockDeleted).toContain(shot('c').uri);
    await m.unmount();
  });

  it('skips a picture still too large after shrinking, says so, and sends the others', async () => {
    encoded = { [shot('a').uri]: 'A'.repeat(SHOT_MAX_CHARS + 1), [shot('b').uri]: 'BBBB' };
    chosen(shot('a'), shot('b'));
    const m = await mount();

    await act(async () => {
      await m.vm.actions.choose();
    });

    expect(pond.sendScreenshot.mock.calls).toEqual([['BBBB', 'image/jpeg']]);
    expect(m.vm.sent).toBe(1);
    expect(currentSnackbar()).toMatchObject({ message: 'One screenshot was too large to send.', tone: 'danger' });
    await m.unmount();
  });

  it('says the picker would not open, and sends nothing', async () => {
    library.mockRejectedValue(new Error('Another picker is already presented'));
    const m = await mount();

    await act(async () => {
      await m.vm.actions.choose();
    });

    expect(pond.sendScreenshot).not.toHaveBeenCalled();
    expect(m.vm.sending).toBe(false);
    expect(currentSnackbar()).toMatchObject({ tone: 'danger', message: expect.stringMatching(/picker would not open/) });
    await m.unmount();
  });

  it('stops on any other refusal and says the Pond could not do it', async () => {
    pond.sendScreenshot.mockRejectedValue(new ApiError('POST → 500', 500, null));
    chosen(shot('a'), shot('b'));
    const m = await mount();

    await act(async () => {
      await m.vm.actions.choose();
    });

    expect(pond.sendScreenshot).toHaveBeenCalledTimes(1);
    expect(m.vm.sent).toBeNull();
    expect(currentSnackbar()).toMatchObject({ message: 'Your Pond is busy right now.', tone: 'danger' });
    await m.unmount();
  });
});

describe('what Goose noted', () => {
  it('deletes one line at once, and puts it back in its place when the Pond refuses', async () => {
    const m = await mount();

    await act(async () => {
      await m.vm.actions.remove(m.vm.data.notes[1]);
    });
    expect(pond.deleteScreenshotNote).toHaveBeenCalledWith('n2');
    expect(m.vm.data.notes.map((n) => n.id)).toEqual(['n1', 'n3']);
    expect(currentSnackbar()).toMatchObject({ message: 'Deleted', tone: 'success' });

    pond.deleteScreenshotNote.mockRejectedValue(new ApiError('DELETE → 500', 500, null));
    await act(async () => {
      await m.vm.actions.remove(m.vm.data.notes[0]);
    });
    expect(m.vm.data.notes.map((n) => n.id)).toEqual(['n1', 'n3']);
    expect(currentSnackbar()).toMatchObject({ tone: 'danger' });
    await m.unmount();
  });

  it('deletes every line and what was waiting, and puts them back when the Pond refuses', async () => {
    held = { ...held, pending: 2 };
    const m = await mount();

    pond.deleteAllScreenshotNotes.mockRejectedValueOnce(new ApiError('DELETE → 500', 500, null));
    await act(async () => {
      await m.vm.actions.removeAll();
    });
    expect(m.vm.data.notes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    expect(m.vm.data.pending).toBe(2);
    expect(m.vm.clearing).toBe(false);

    await act(async () => {
      await m.vm.actions.removeAll();
    });
    expect(pond.deleteAllScreenshotNotes).toHaveBeenCalledTimes(2);
    expect(m.vm.data).toMatchObject({ notes: [], pending: 0 });
    expect(currentSnackbar()).toMatchObject({ message: 'All deleted', tone: 'success' });
    await m.unmount();
  });
});
