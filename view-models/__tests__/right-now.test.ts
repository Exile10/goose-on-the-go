/**
 * The Home tab's greeting and its "Right now" cards, from what the Pond and the clock say.
 *
 * Before this the tab greeted "Good morning, Jerry" at 22:40, showed 72 degrees Fahrenheit from a
 * Pond that reports Celsius, Lo-fi Beats that were not playing, and a 2:00 PM Team Standup from a
 * calendar the product does not integrate with. Each rule below is one of those, fixed.
 */
import { ApiError } from '@/services/api-client';
import type { UpcomingSchedule } from '@/services/types';
import {
  NOW_PLAYING_BACKOFF_MS,
  NOW_PLAYING_MS,
  greetingFor,
  nextRoutineOf,
  nowPlayingDelay,
  nowPlayingOf,
  readNowPlaying,
  readRightNow,
  untilOf,
} from '../use-right-now';

describe('greetingFor', () => {
  it('says morning from five until noon', () => {
    expect(greetingFor(5)).toBe('morning');
    expect(greetingFor(11)).toBe('morning');
  });

  it('says afternoon from noon until five', () => {
    expect(greetingFor(12)).toBe('afternoon');
    expect(greetingFor(16)).toBe('afternoon');
  });

  // The screenshot this issue was reported against was taken at 22:40.
  it('says evening at 22:40, and through the small hours', () => {
    expect(greetingFor(22)).toBe('evening');
    expect(greetingFor(17)).toBe('evening');
    expect(greetingFor(0)).toBe('evening');
    expect(greetingFor(4)).toBe('evening');
  });
});

describe('nowPlayingOf', () => {
  it('shows nothing without an account to ask', () => {
    expect(nowPlayingOf({ connected: false })).toBeNull();
  });

  // Spotify answered and refused. Whatever else is in the body, it is not a report of playback.
  it('shows nothing when Spotify refused to say', () => {
    expect(nowPlayingOf({ connected: true, playing: true, track: 'Stale', error: 'rate_limited' })).toBeNull();
  });

  it('says nothing is playing only when the Pond said so', () => {
    expect(nowPlayingOf({ connected: true, playing: false })).toEqual({ state: 'idle' });
  });

  it('names the track and artist that are playing', () => {
    expect(nowPlayingOf({ connected: true, playing: true, track: 'Blue in Green', artist: 'Miles Davis' })).toEqual({
      state: 'playing',
      track: 'Blue in Green',
      artist: 'Miles Davis',
    });
  });

  it('does not claim playback it cannot name', () => {
    expect(nowPlayingOf({ connected: true, playing: true })).toBeNull();
  });
});

describe('nextRoutineOf', () => {
  const at = (id: string, next_run: string | null, paused = false): UpcomingSchedule => ({
    id,
    label: `Routine ${id}`,
    next_run,
    paused,
  });

  it('is the first active routine with a time to run', () => {
    const list = [at('a', null), at('b', '2026-09-23T04:00:00Z', true), at('c', 'not a date'), at('d', '2026-09-23T05:00:00Z')];
    expect(nextRoutineOf(list)).toEqual({ label: 'Routine d', nextRun: new Date('2026-09-23T05:00:00Z') });
  });

  it('is nothing when no routine is due', () => {
    expect(nextRoutineOf([])).toBeNull();
    expect(nextRoutineOf([at('a', null)])).toBeNull();
  });
});

describe('untilOf', () => {
  const now = new Date('2026-09-23T10:00:00Z');
  const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  it('counts minutes, then hours, then days', () => {
    expect(untilOf(later(45), now)).toEqual({ unit: 'minutes', count: 45 });
    expect(untilOf(later(180), now)).toEqual({ unit: 'hours', count: 3 });
    expect(untilOf(later(2 * 24 * 60), now)).toEqual({ unit: 'days', count: 2 });
  });

  // Upcoming is sorted by next fire, and a scheduler that has not yet run a due routine leaves its
  // next_run in the past. That is "due now", not a negative number of minutes.
  it('calls a routine whose time has come due now', () => {
    expect(untilOf(later(0), now)).toEqual({ unit: 'now' });
    expect(untilOf(later(-7), now)).toEqual({ unit: 'now' });
  });
});

describe('readRightNow', () => {
  function pond(overrides: Partial<Parameters<typeof readRightNow>[0]> = {}) {
    return {
      weather: async () => ({ enabled: true, temp: 22 }),
      nowPlaying: async () => ({ connected: true, playing: false }),
      upcomingSchedules: async () => [{ id: 's', label: 'Morning briefing', next_run: '2026-09-23T04:00:00Z', paused: false }],
      ...overrides,
    };
  }

  it('reads all three cards', async () => {
    await expect(readRightNow(pond())).resolves.toEqual({
      outdoorTemp: 22,
      nowPlaying: { state: 'idle' },
      nextRoutine: { label: 'Morning briefing', nextRun: new Date('2026-09-23T04:00:00Z') },
    });
  });

  // No location configured is a setting, not a temperature. The temperature is present here on
  // purpose: with it absent this passed without ever reaching the `enabled` check, which a
  // mutation dropping that check confirmed.
  it('shows no temperature from a Pond with no location set, whatever else it sent', async () => {
    const r = await readRightNow(pond({ weather: async () => ({ enabled: false, temp: 99 }) }));
    expect(r.outdoorTemp).toBeNull();
  });

  it('loses only the card whose read failed', async () => {
    const r = await readRightNow(pond({ nowPlaying: async () => { throw new ApiError('bad gateway', 502, null); } }));
    expect(r.nowPlaying).toBeNull();
    expect(r.outdoorTemp).toBe(22);
    expect(r.nextRoutine).not.toBeNull();
  });
});

/**
 * How often Now Playing asks, following the desktop's rule: every call reaches Spotify, so a
 * refusal that only a person can fix is not asked about every ten seconds.
 */
describe('now playing cadence', () => {
  const reading = (r: object) => readNowPlaying({ nowPlaying: async () => r as never });

  it('asks every ten seconds while Spotify is answering', async () => {
    expect(nowPlayingDelay(await reading({ connected: true, playing: true, track: 'A' }))).toBe(NOW_PLAYING_MS);
    expect(nowPlayingDelay(await reading({ connected: true, playing: false }))).toBe(NOW_PLAYING_MS);
  });

  it('backs off with no account to ask', async () => {
    expect(nowPlayingDelay(await reading({ connected: false }))).toBe(NOW_PLAYING_BACKOFF_MS);
  });

  it('backs off when Spotify refused', async () => {
    expect(nowPlayingDelay(await reading({ connected: true, error: 'rate_limited' }))).toBe(NOW_PLAYING_BACKOFF_MS);
  });

  // A Pond that is restarting, or a phone between networks, is not a refusal. Backing off here
  // would leave the card five minutes stale after a blip, which is the bug this fixes.
  it('keeps its cadence when the Pond could not be reached', async () => {
    const r = await readNowPlaying({ nowPlaying: async () => { throw new ApiError('bad gateway', 502, null); } });
    expect(r.card).toBeNull();
    expect(nowPlayingDelay(r)).toBe(NOW_PLAYING_MS);
  });
});
