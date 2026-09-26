/**
 * Keep a screen's data current while it is in front, and spend nothing while it is not.
 *
 * Screens used to read the Pond once, when they mounted, so what they showed was a snapshot: Now
 * Playing kept a track that had finished ten minutes earlier. This is the one mechanism every
 * live screen polls through, so the rules that keep polling safe live in one place:
 *
 * - it reads only while its screen is focused and the app is not in the background;
 * - it reads at once on arrival, so a screen returned to is current straight away;
 * - it never starts a read while the previous one is still out;
 * - it never waits less than `MIN_POLL_MS`, whatever it is asked for.
 *
 * The Pond rate-limits per IP, and a runaway loop once spent the whole budget in seconds and
 * locked this phone out of `/handshake`, the recovery path. A failed read is not retried early:
 * the next tick is the retry.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

/** The floor on any poll's delay. A bug in a delay function cannot turn a poll into a flood. */
export const MIN_POLL_MS = 5_000;

export interface LiveLoop {
  start(): void;
  stop(): void;
}

/**
 * The scheduling on its own, with no React in it, so its rules can be tested with fake timers.
 *
 * The next read is scheduled when the previous one settles, not on a fixed interval: a slow Pond
 * slows the poll instead of stacking requests behind it. `delayAfter` is asked after each read,
 * which is how a source backs off.
 */
export function liveLoop(read: () => Promise<unknown>, delayAfter: () => number): LiveLoop {
  // Each start is a generation. A read still out when the loop stops, or restarts, belongs to an
  // old one and must not schedule another; without this a stop-start pair would run two chains.
  let generation = 0;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (gen: number) => {
    if (gen !== generation) return;
    try {
      await read();
    } catch {
      // Nothing to do: the next tick is the retry, at the same cadence.
    }
    if (gen !== generation) return;
    const asked = delayAfter();
    const wait = Number.isFinite(asked) && asked > MIN_POLL_MS ? asked : MIN_POLL_MS;
    timer = setTimeout(() => void tick(gen), wait);
  };

  return {
    start() {
      if (running) return;
      running = true;
      const gen = ++generation;
      // On a microtask rather than inline, so a caller starting this inside an effect does not
      // update state synchronously in that effect.
      void Promise.resolve().then(() => tick(gen));
    },
    stop() {
      running = false;
      generation++;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * Poll `read` while the calling screen is focused and the app is in the foreground.
 *
 * `enabled` holds the loop off entirely -- a view-model passes whether the base URL and token
 * have arrived, since reading before they land calls the default address unauthenticated.
 * `delay` may be a function, asked after each read.
 */
export function useLive(read: () => Promise<unknown>, delay: number | (() => number), enabled = true): void {
  // The latest callbacks, without restarting the loop every render they change on.
  const readRef = useRef(read);
  const delayRef = useRef(delay);
  useEffect(() => {
    readRef.current = read;
    delayRef.current = delay;
  });

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const loop = liveLoop(
        () => readRef.current(),
        () => {
          const d = delayRef.current;
          return typeof d === 'function' ? d() : d;
        },
      );
      // Only a known background state holds it off: on an Android cold start AppState can read
      // 'unknown' while the screen is plainly on show.
      if (AppState.currentState !== 'background') loop.start();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') loop.start();
        else if (state === 'background') loop.stop();
      });
      return () => {
        sub.remove();
        loop.stop();
      };
    }, [enabled]),
  );
}
