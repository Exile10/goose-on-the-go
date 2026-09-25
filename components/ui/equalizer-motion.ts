/**
 * How each Now Playing bar moves, as plain numbers.
 *
 * Kept apart from the component so it can be tested without Reanimated, whose native worklets do
 * not exist under Jest. See `equalizer-bars.tsx` for why the bars move at all.
 */

export interface BarMotion {
  /** Milliseconds for one rise, and again for one fall. */
  period: number;
  /** Scale at the bottom and top of the swing, as a share of the row's height. */
  low: number;
  high: number;
  /** Where the bar rests when it is not moving. */
  rest: number;
  /** Milliseconds before this bar starts, so they do not all begin in step. */
  delay: number;
}

/**
 * Bar `index`'s motion. Fixed per bar rather than random, so the row renders the same every time
 * and render stays pure; the golden-ratio step spreads the values without two bars matching.
 */
export function equalizerMotion(index: number): BarMotion {
  const spread = (index * 0.618033988749895) % 1;
  return {
    period: Math.round(320 + spread * 460),
    low: 0.2 + ((spread * 7) % 1) * 0.2,
    high: 0.75 + ((spread * 3) % 1) * 0.25,
    rest: 0.3 + ((spread * 5) % 1) * 0.4,
    delay: Math.round(spread * 240),
  };
}
