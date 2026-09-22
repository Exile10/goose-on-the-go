/**
 * The Home tab's "Right now" row: the outdoor temperature, what is playing, and the next routine.
 *
 * Each card is one read and each can be absent. A card with nothing true to say is not drawn,
 * which is the whole change: these used to show 72 degrees Fahrenheit from a Pond that reports
 * Celsius, Lo-fi Beats that were not playing, and a 2:00 PM Team Standup from a calendar the
 * product does not integrate with.
 *
 * The next-routine card replaced that meeting. Its data is real -- the Pond's own schedules,
 * soonest first -- but it is not what the card first claimed, so it is labelled a routine and
 * never an event.
 */
import { useCallback, useEffect, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { api, type PondApiClient } from '@/services/api-client';
import type { NowPlayingResponse, UpcomingSchedule } from '@/services/types';

export type Greeting = 'morning' | 'afternoon' | 'evening';

export type NowPlaying = { state: 'playing'; track: string; artist: string | null } | { state: 'idle' };

export interface NextRoutine {
  label: string;
  nextRun: Date;
}

export type Until = { unit: 'now' } | { unit: 'minutes' | 'hours' | 'days'; count: number };

export interface RightNow {
  /** Degrees Celsius outside, or null: no location configured, or the read failed. */
  outdoorTemp: number | null;
  nowPlaying: NowPlaying | null;
  nextRoutine: NextRoutine | null;
}

export interface UseRightNow {
  data: RightNow;
  loading: boolean;
  actions: { refresh: () => Promise<void> };
}

const UNREAD: RightNow = { outdoorTemp: null, nowPlaying: null, nextRoutine: null };

/** Which greeting the phone's own clock calls for. */
export function greetingFor(hour: number): Greeting {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

/**
 * What the card may honestly say about playback, or null for nothing.
 *
 * `connected: true, playing: false` is the only answer that means "nothing is playing". An error
 * means Spotify answered and refused, and a claim of playback with no track cannot be named.
 */
export function nowPlayingOf(r: NowPlayingResponse): NowPlaying | null {
  if (!r.connected || r.error) return null;
  if (r.playing === false) return { state: 'idle' };
  if (r.playing && r.track) return { state: 'playing', track: r.track, artist: r.artist ?? null };
  return null;
}

/** The soonest routine that will actually run: not paused, with a real time to run at. */
export function nextRoutineOf(upcoming: UpcomingSchedule[]): NextRoutine | null {
  for (const s of upcoming) {
    if (s.paused || !s.next_run) continue;
    const nextRun = new Date(s.next_run);
    if (Number.isNaN(nextRun.getTime())) continue;
    return { label: s.label, nextRun };
  }
  return null;
}

/**
 * How far off `at` is, in the largest whole unit that reads naturally.
 *
 * A time already passed is "due now": a scheduler that has not yet run a due routine leaves its
 * next_run behind the clock, and a negative countdown would read as a bug.
 */
export function untilOf(at: Date, now: Date): Until {
  const minutes = Math.round((at.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return { unit: 'now' };
  if (minutes < 60) return { unit: 'minutes', count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { unit: 'hours', count: hours };
  return { unit: 'days', count: Math.round(hours / 24) };
}

type RightNowReader = Pick<PondApiClient, 'weather' | 'nowPlaying' | 'upcomingSchedules'>;

/** Read the row in one pass. Never rejects: a card whose read fails is absent, not wrong. */
export async function readRightNow(client: RightNowReader = api): Promise<RightNow> {
  const [weather, playing, upcoming] = await Promise.allSettled([
    client.weather(),
    client.nowPlaying(),
    // Paused schedules come back too, so ask for a few and take the first that will run.
    client.upcomingSchedules(5),
  ]);
  return {
    outdoorTemp:
      weather.status === 'fulfilled' && weather.value.enabled && typeof weather.value.temp === 'number'
        ? weather.value.temp
        : null,
    nowPlaying: playing.status === 'fulfilled' ? nowPlayingOf(playing.value) : null,
    nextRoutine: upcoming.status === 'fulfilled' ? nextRoutineOf(upcoming.value) : null,
  };
}

export function useRightNow(): UseRightNow {
  const [rightNow, setRightNow] = useState<RightNow>(UNREAD);
  const [loading, setLoading] = useState(true);

  // The base URL and bearer token arrive asynchronously; reading before they land calls the
  // default address unauthenticated and never retries.
  const { hydrated } = useServer();

  // State is set in the promise's callback, never synchronously in the effect, and not at all
  // once the screen has gone.
  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    void readRightNow().then((next) => {
      if (!live) return;
      setRightNow(next);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [hydrated]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setRightNow(await readRightNow());
    setLoading(false);
  }, []);

  return { data: rightNow, loading, actions: { refresh } };
}
