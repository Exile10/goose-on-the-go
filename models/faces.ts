/**
 * The words and numbers behind the Faces screen: how many samples are enough, how strict a match
 * may be made, and what each way the pond can refuse a sample means for the person holding the
 * phone.
 */

import i18n from '@/services/i18n';
import type { FacePerson } from '@/services/types';

/** Samples worth asking for. The pond advises three or more; five is as far as it is worth pushing. */
export const SAMPLES_MIN = 3;
export const SAMPLES_ENOUGH_UP_TO = 5;

/** How far either side of the pond's own strictness the slider reaches, so it never offers a nonsense end. */
const STRICTNESS_REACH = 0.25;
export const STRICTNESS_STEP = 0.01;

export function toPercent(fraction: number): number {
  return Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
}

/** The strictness slider's ends, around the pond's default and wide enough to hold a stored value. */
export function strictnessRange(defaultThreshold: number, own: number | null): { min: number; max: number } {
  const base = defaultThreshold > 0 ? defaultThreshold : 0.5;
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const min = Math.min(clamp(base - STRICTNESS_REACH, 0.05, 0.9), own ?? Infinity);
  const max = Math.max(clamp(base + STRICTNESS_REACH, 0.1, 0.99), own ?? -Infinity);
  return { min: Number(min.toFixed(2)), max: Number(max.toFixed(2)) };
}

/** What the count of samples says to do next. */
export function describeSamples(count: number): string {
  if (count <= 0) return i18n.t('faces.sheet.samples.none');
  if (count < SAMPLES_MIN) return i18n.t('faces.sheet.samples.few', { count });
  if (count <= SAMPLES_ENOUGH_UP_TO) return i18n.t('faces.sheet.samples.enough', { count });
  return i18n.t('faces.sheet.samples.plenty', { count });
}

/** "4 samples", or "No samples". */
export function sampleCount(count: number): string {
  return count > 0 ? i18n.t('faces.person.samples', { count }) : i18n.t('faces.person.noSamples');
}

/** How many people the pond knows by face: those with at least one sample. */
export function knownByFace(people: readonly Pick<FacePerson, 'enrollments'>[]): number {
  return people.filter((p) => p.enrollments > 0).length;
}

/** Everyone, those the pond knows first, then by name. */
export function orderPeople<T extends Pick<FacePerson, 'enrollments' | 'name'>>(people: readonly T[]): T[] {
  return [...people].sort(
    (a, b) => Number(b.enrollments > 0) - Number(a.enrollments > 0) || a.name.localeCompare(b.name),
  );
}

/** The first letter of a name, for the circle that stands in for a picture of them. */
export function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}
