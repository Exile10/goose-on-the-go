/**
 * Hearing a voice before keeping it, as pond-desktop's picker does: one line at a time, in order,
 * so two voices are compared on the same words, with the clip's own loudness driving the face.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import i18n, { type TranslationKey } from '@/services/i18n';
import { envelope, orbLevel } from '@/services/speech';
import { cacheFile, discardFile, playFile } from '@/services/voice-io';
import { describeApiError } from './describe-error';

/** Cycled, not random: comparing two voices is only fair if they say the same line. */
export const PREVIEW_LINES = [
  'settings.voice.lines.0',
  'settings.voice.lines.1',
  'settings.voice.lines.2',
  'settings.voice.lines.3',
  'settings.voice.lines.4',
  'settings.voice.lines.5',
  'settings.voice.lines.6',
] as const satisfies readonly TranslationKey[];

/** The desktop's 30 ms window, so the face moves with syllables rather than words. */
const WINDOW_MS = 30;

export type PreviewState = 'idle' | 'loading' | 'playing' | 'error';

export interface VoicePreview {
  state: PreviewState;
  busy: boolean;
  error: string | null;
  /** The line being said, or about to be. */
  statement: string | null;
  /** 0 to 1, scaled for the orb as `orbLevel` does. */
  level: number;
  play: () => Promise<void>;
  stop: () => void;
}

/** The clip's RMS at the playhead, scaled as the desktop scales it before the orb does. */
export function levelAt(levels: readonly number[], stepMs: number, seconds: number): number {
  if (levels.length === 0) return 0;
  const at = Math.min(levels.length - 1, Math.floor((seconds * 1000) / stepMs));
  return orbLevel(Math.min(1, (levels[at] ?? 0) * 3));
}

export function useVoicePreview(): VoicePreview {
  const { isScreenReal } = useServer();
  const [state, setState] = useState<PreviewState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [statement, setStatement] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  // Each play supersedes the last; a reply to an older one is dropped.
  const generation = useRef(0);
  const plays = useRef(0);
  const stopPlaying = useRef<() => void>(() => {});

  const stop = useCallback(() => {
    generation.current += 1;
    stopPlaying.current();
    stopPlaying.current = () => {};
    setLevel(0);
    setState('idle');
  }, []);

  useEffect(
    () => () => {
      generation.current += 1;
      stopPlaying.current();
    },
    [],
  );

  const play = useCallback(async () => {
    if (!isScreenReal('settings')) return;
    generation.current += 1;
    const mine = generation.current;
    stopPlaying.current();
    const line = i18n.t(PREVIEW_LINES[plays.current % PREVIEW_LINES.length]);
    setStatement(line);
    setState('loading');
    setError(null);
    setLevel(0);
    try {
      const wav = new Uint8Array(await api.speak(line));
      if (generation.current !== mine) return;
      const env = envelope(wav, WINDOW_MS);
      const uri = cacheFile('preview', wav);
      const playing = playFile(uri, (seconds) => {
        if (generation.current === mine) setLevel(levelAt(env.levels, env.stepMs, seconds));
      });
      stopPlaying.current = playing.stop;
      plays.current += 1;
      setState('playing');
      await playing.done;
      discardFile(uri);
      if (generation.current !== mine) return;
      stopPlaying.current = () => {};
      setLevel(0);
      setState('idle');
    } catch (e) {
      if (generation.current !== mine) return;
      setLevel(0);
      setState('error');
      setError(describeApiError(e) ?? i18n.t('settings.voice.previewFailed'));
    }
  }, [isScreenReal]);

  return { state, busy: state === 'loading' || state === 'playing', error, statement, level, play, stop };
}
