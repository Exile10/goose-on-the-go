/**
 * The small lines Goose says while it works, and greets with.
 *
 * pond-desktop's lists (`components/quips.ts`, `ThinkingPlaceholder.tsx`),
 * kept in the catalogue as numbered keys so they translate like every other
 * string. The counts live here, beside the one function that turns a seed into
 * a key, and a test holds them to the catalogue so a line added there is not
 * silently never shown.
 */

import type { TranslationKey } from '@/services/i18n';

export const THINKING_QUIPS = 20;
export const WORKING_QUIPS = 6;
export const GREETINGS_PER_PERIOD = 4;
export const SUBTITLES = 3;

export type Period = 'morning' | 'afternoon' | 'evening' | 'night';

/** pond-desktop's boundaries: before 5 is night, then morning to 12, afternoon to 17, evening to 22. */
export function periodOf(hour: number): Period {
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

/** A seed, to an index into a list of `count`: the desktop's `pick`. */
export function pick(seed: number, count: number): number {
  return Math.abs(Math.trunc(seed)) % count;
}

export function quipKey(list: 'thinking' | 'working', index: number): TranslationKey {
  return `chat.quips.${list}.${index}` as TranslationKey;
}

export function greetingKey(period: Period | 'anonymous', index: number): TranslationKey {
  return `chat.greeting.${period}.${index}` as TranslationKey;
}

export function subtitleKey(index: number): TranslationKey {
  return `chat.greeting.subtitle.${index}` as TranslationKey;
}
