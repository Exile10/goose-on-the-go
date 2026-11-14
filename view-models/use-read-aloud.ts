/**
 * A reply read aloud on this phone, in the Pond's own voice. One at a time: starting another stops
 * the first. The reply is cut into the parts the Pond's Kokoro says well in one pass, and each part
 * is asked for while the one before plays, so a long reply starts at once and runs on without a gap.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import i18n from '@/services/i18n';
import { api } from '@/services/api-client';
import { showSnackbar } from '@/services/snackbar';
import { takeSpeechUnits, type SpeechUnit } from '@/services/speech';
import { cacheFile, discardFile, playFile } from '@/services/voice-io';

let reading: { id: string; stop: () => void } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const readingId = () => reading?.id ?? null;

function say(unit: SpeechUnit, signal: AbortSignal): Promise<string> {
  return api.speak(unit.text, signal, unit.last).then((wav) => cacheFile('read', new Uint8Array(wav)));
}

/** Reads `text` aloud as the reply `id`, or stops it if that reply is the one being read. */
export function toggleReadAloud(id: string, text: string): void {
  const was = reading?.id;
  reading?.stop();
  if (was === id) return;
  const { units } = takeSpeechUnits(text, 0, true);
  if (units.length === 0) return;

  const abort = new AbortController();
  let player: { stop: () => void } | null = null;
  const run = {
    id,
    stop: () => {
      abort.abort();
      player?.stop();
      if (reading === run) {
        reading = null;
        emit();
      }
    },
  };
  reading = run;
  emit();

  void (async () => {
    const played: string[] = [];
    let next: Promise<string> | null = say(units[0], abort.signal);
    try {
      for (let i = 0; next; i += 1) {
        const uri: string = await next;
        played.push(uri);
        next = null;
        if (abort.signal.aborted) break;
        next = i + 1 < units.length ? say(units[i + 1], abort.signal) : null;
        // Asked for ahead; a stop may leave it unread, and its failure is met when it is awaited.
        next?.catch(() => undefined);
        const playing = playFile(uri, () => {});
        player = playing;
        await playing.done;
        if (abort.signal.aborted) break;
      }
    } catch {
      if (!abort.signal.aborted) showSnackbar({ message: i18n.t('chat.reply.readFailed'), tone: 'danger' });
    } finally {
      played.forEach(discardFile);
      next?.then(discardFile, () => undefined);
      if (reading === run) {
        reading = null;
        emit();
      }
    }
  })();
}

/** Whether this reply is being read, and the button's press. A reply that leaves the screen stops. */
export function useReadAloud(id: string) {
  const now = useSyncExternalStore(subscribe, readingId, readingId);
  useEffect(
    () => () => {
      if (reading?.id === id) reading.stop();
    },
    [id],
  );
  const toggle = useCallback((text: string) => toggleReadAloud(id, text), [id]);
  return { reading: now === id, toggle };
}
