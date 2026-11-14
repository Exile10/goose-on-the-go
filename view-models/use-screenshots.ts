// Ideas from the member's screenshots: the opt-in, sending the ones they choose, and the lines the
// Pond kept about them (pond docs/architecture/my-goose-hub.md, part 6b). Nothing is sent while it
// is off, and no picture outlives its sending: not in state, not in the app's cache.

import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';

import { EMPTY_SCREENSHOTS, SHOT_MAX_CHARS, SHOT_MAX_SIDE, roomToSend, type ScreenshotNote, type Screenshots } from '@/models/screenshots';
import { ApiError, api } from '@/services/api-client';
import { confirm } from '@/services/haptics';
import i18n, { type TranslationKey } from '@/services/i18n';
import { fitLongEdge } from '@/services/media';
import { showSnackbar } from '@/services/snackbar';
import { describeApiError, logFailure } from './describe-error';
import { hubAction, useHubRead } from './hub-read';
import { useLive } from './use-live';

/** While the Pond still has screenshots to read, a look every few seconds for the lines it writes. */
export const SHOTS_WAITING_MS = 5_000;
export const SHOTS_MS = 5 * 60_000;

/** Enough to read a screen's words by; the Pond takes about 1.5 MB a picture. */
const SHOT_QUALITY = 0.7;
// eslint-disable-next-line i18next/no-literal-string -- a media type, not copy
const SHOT_TYPE = 'image/jpeg';

type Picker = typeof import('expo-image-picker');
type Manipulator = typeof import('expo-image-manipulator');

function load<T>(get: () => T): T | null {
  try {
    return get();
  } catch {
    return null;
  }
}

// Loaded on first use, as the composer's are: a build without the native half fails this button, not the launch.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const picker = () => load<Picker>(() => require('expo-image-picker'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const manipulator = () => load<Manipulator>(() => require('expo-image-manipulator'));

/** A picture the member chose, as the picker left it in the app's cache. */
export interface PickedShot {
  uri: string;
  width: number;
  height: number;
}

/** Why the picker gave nothing, as the words to say. */
export class ShotPickError extends Error {
  readonly key: TranslationKey;
  constructor(key: TranslationKey) {
    super(key);
    this.name = 'ShotPickError';
    this.key = key;
  }
}

/**
 * Up to `room` pictures from the photo library. The system picker hands over only what was chosen,
 * so there is no library permission to ask for; a platform that refuses for one says so.
 */
export async function pickShots(room: number): Promise<PickedShot[]> {
  const lib = picker();
  if (!lib) throw new ShotPickError('goose.shots.needsUpdate');
  let result: Awaited<ReturnType<Picker['launchImageLibraryAsync']>>;
  try {
    result = await lib.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: room > 1,
      selectionLimit: room,
      orderedSelection: true,
      quality: 1,
      exif: false,
    });
  } catch (e) {
    throw new ShotPickError(/permission/i.test(String(e)) ? 'goose.shots.permission' : 'goose.shots.pickerFailed');
  }
  if (result.canceled) return [];
  return result.assets.map(({ uri, width, height }) => ({ uri, width, height }));
}

// Only the app's own cache: a uri from anywhere else is the member's picture, not a copy of it.
function forget(uri: string): void {
  try {
    if (!uri.startsWith(Paths.cache.uri)) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The cache is the system's to clear; a copy that will not go now goes then.
  }
}

/**
 * The picture as a JPEG no longer than `SHOT_MAX_SIDE` on its long side, in base64, or null when
 * it cannot be read. The file the re-encoding writes is removed before this returns.
 */
export async function shrinkShot(shot: PickedShot): Promise<string | null> {
  const lib = manipulator();
  if (!lib) return null;
  const held: { release: () => void }[] = [];
  const render = async (size?: { width: number; height: number }) => {
    const context = lib.ImageManipulator.manipulate(shot.uri);
    held.push(context);
    const image = await (size ? context.resize(size) : context).renderAsync();
    held.push(image);
    return image;
  };
  try {
    // The picker can leave the size at 0; a first render says what it is.
    const size = shot.width > 0 && shot.height > 0 ? shot : await render();
    const fit = fitLongEdge(size.width, size.height, SHOT_MAX_SIDE);
    const image = await render(fit.width === size.width && fit.height === size.height ? undefined : fit);
    const saved = await image.saveAsync({ format: lib.SaveFormat.JPEG, compress: SHOT_QUALITY, base64: true });
    forget(saved.uri);
    return saved.base64 ?? null;
  } catch (e) {
    logFailure('screenshots', 'shrink failed', e);
    return null;
  } finally {
    for (const object of held) {
      try {
        object.release();
      } catch {
        // Already let go; the decoded picture is what must not wait for the collector.
      }
    }
  }
}

export function useScreenshots() {
  const shots = useHubRead<Screenshots>('screenshots', () => api.screenshots(), EMPTY_SCREENSHOTS, SHOTS_MS);
  const { data, setData, reload } = shots;
  const [toggling, setToggling] = useState(false);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  /** How many the last choosing sent. */
  const [sent, setSent] = useState<number | null>(null);
  const latest = useRef(data);
  // Read before every send. It is false from the moment the switch moves until the Pond has answered.
  const maySend = useRef(false);
  const switching = useRef(false);
  const choosing = useRef(false);
  useEffect(() => {
    latest.current = data;
    maySend.current = data.enabled && data.available && !toggling;
  });

  // The hub read asks for its next delay only after a read, so a send would wait minutes for one.
  useLive(reload, SHOTS_WAITING_MS, data.pending > 0);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      const before = latest.current;
      if (switching.current || before.enabled === enabled || (enabled && !before.available)) return;
      switching.current = true;
      maySend.current = false;
      setToggling(true);
      setData((d) => ({ ...d, enabled }));
      const answer = await hubAction('screenshots', () => api.setScreenshots(enabled));
      switching.current = false;
      setToggling(false);
      if (!answer) {
        setData((d) => ({ ...d, enabled: before.enabled }));
        return;
      }
      setData(answer);
      if (!answer.enabled) setSent(null);
      showSnackbar({ message: i18n.t(answer.enabled ? 'goose.shots.turnedOn' : 'goose.shots.turnedOff'), tone: 'success' });
    },
    [setData],
  );

  /** Opens the photo library and sends what is chosen, one at a time, as far as the Pond has room. */
  const choose = useCallback(async () => {
    if (choosing.current || !maySend.current) return;
    let room = roomToSend(latest.current);
    if (room <= 0) return;
    choosing.current = true;
    setSending(true);
    setSent(null);
    let picked: PickedShot[] = [];
    let count = 0;
    let problem: string | null = null;
    try {
      picked = await pickShots(room);
      for (const shot of picked) {
        if (room <= 0 || !maySend.current) break;
        const image = await shrinkShot(shot);
        forget(shot.uri);
        if (!image) {
          problem = i18n.t('goose.shots.unreadable');
          continue;
        }
        if (image.length > SHOT_MAX_CHARS) {
          problem = i18n.t('goose.shots.tooLarge');
          continue;
        }
        if (!maySend.current) break;
        try {
          const waiting = await api.sendScreenshot(image, SHOT_TYPE);
          count += 1;
          room -= 1;
          setData((d) => ({ ...d, pending: waiting > 0 ? waiting : d.pending + 1 }));
        } catch (e) {
          logFailure('screenshots', 'send failed', e);
          // Turned off while this one was on its way: the refusal is what was asked for.
          if (!maySend.current) break;
          if (e instanceof ApiError && e.status === 429) {
            // The Pond's queue is full, whatever the last read said: show it full and stop.
            setData((d) => ({ ...d, pending: d.maxPending }));
            break;
          }
          if (e instanceof ApiError && e.status === 413) {
            problem = i18n.t('goose.shots.tooLarge');
            continue;
          }
          // A 409 is the Pond saying it is off there: read what it has now.
          if (e instanceof ApiError && e.status === 409) void reload();
          problem = describeApiError(e) ?? i18n.t('goose.errors.action');
          break;
        }
      }
    } catch (e) {
      logFailure('screenshots', 'choose failed', e);
      problem = e instanceof ShotPickError ? i18n.t(e.key) : i18n.t('goose.errors.action');
    } finally {
      // Whatever the loop did not reach is not kept either.
      for (const shot of picked) forget(shot.uri);
      choosing.current = false;
      setSending(false);
    }
    if (count > 0) {
      setSent(count);
      void confirm();
    }
    if (problem) showSnackbar({ message: problem, tone: 'danger' });
  }, [reload, setData]);

  const remove = useCallback(
    async (note: ScreenshotNote) => {
      const at = latest.current.notes.findIndex((n) => n.id === note.id);
      if (at < 0) return;
      setData((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== note.id) }));
      const gone = await hubAction('screenshots', () => api.deleteScreenshotNote(note.id).then(() => true));
      if (!gone) {
        setData((d) => (d.notes.some((n) => n.id === note.id) ? d : { ...d, notes: [...d.notes.slice(0, at), note, ...d.notes.slice(at)] }));
        return;
      }
      showSnackbar({ message: i18n.t('goose.shots.deleted'), tone: 'success' });
    },
    [setData],
  );

  /** Every line, and every screenshot still waiting to be read. */
  const removeAll = useCallback(async () => {
    const before = latest.current;
    setClearing(true);
    setData((d) => ({ ...d, notes: [], pending: 0 }));
    const gone = await hubAction('screenshots', () => api.deleteAllScreenshotNotes().then(() => true));
    setClearing(false);
    if (!gone) {
      setData((d) => ({ ...d, notes: before.notes, pending: before.pending }));
      return;
    }
    setSent(null);
    showSnackbar({ message: i18n.t('goose.shots.deletedAll'), tone: 'success' });
  }, [setData]);

  return { ...shots, toggling, sending, clearing, sent, room: roomToSend(data), actions: { reload, setEnabled, choose, remove, removeAll } };
}

export type UseScreenshots = ReturnType<typeof useScreenshots>;
