/**
 * The motion each Now Playing bar makes. The animation is visual; what can go wrong quietly is
 * in its numbers, so those are pinned: a bar that scaled past 1 would spill out of its row, one
 * that reached 0 would vanish mid-song, and bars sharing one pace would move in lockstep, which
 * reads as a loading indicator rather than music.
 */
import { equalizerMotion } from '../equalizer-motion';

const motions = Array.from({ length: 8 }, (_, i) => equalizerMotion(i));

it('keeps every bar inside its row and never lets one vanish', () => {
  for (const m of motions) {
    expect(m.low).toBeGreaterThan(0);
    expect(m.high).toBeLessThanOrEqual(1);
    expect(m.low).toBeLessThan(m.high);
    expect(m.rest).toBeGreaterThan(0);
    expect(m.rest).toBeLessThanOrEqual(1);
  }
});

it('gives the bars different paces, so they do not move together', () => {
  expect(new Set(motions.map((m) => m.period)).size).toBe(motions.length);
});

// Deterministic, so the row renders the same each time and render stays pure.
it('gives a bar the same motion every time it is asked', () => {
  expect(equalizerMotion(3)).toEqual(equalizerMotion(3));
});

it('paces each swing like music, neither frantic nor sluggish', () => {
  for (const m of motions) {
    expect(m.period).toBeGreaterThanOrEqual(250);
    expect(m.period).toBeLessThanOrEqual(900);
  }
});
