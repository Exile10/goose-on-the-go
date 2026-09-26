/**
 * How long remote access has left before it lapses.
 *
 * A device renews its remote access by being on the household's own network.
 * Thirty days without that and the Pond revokes it -- deliberately, so a phone
 * that is lost or belongs to somebody who has left does not keep a route in
 * forever. The cost of that rule is somebody travelling who finds out by losing
 * access, so the app has to say it beforehand.
 *
 * Pure, and separate from the view-model, because the interesting part is the
 * arithmetic at the boundaries: what counts as soon enough to mention, and what
 * to say on the day itself.
 */

/** Say nothing until the deadline is this close. */
export const LAPSE_WARNING_DAYS = 7;

export interface Lapse {
  /** Whole days remaining; negative once the deadline has passed. */
  days: number;
  /** Whether the user should be told now. */
  warn: boolean;
}

/**
 * `lapsesAt` is the RFC3339 deadline the Pond reports, or null when it has no
 * sighting to count from — a Pond older than this feature reports nothing, and
 * silence must not be read as "lapsing today".
 */
export function lapseIn(lapsesAt: string | null | undefined, now = Date.now()): Lapse | null {
  if (!lapsesAt) return null;
  const at = Date.parse(lapsesAt);
  if (Number.isNaN(at)) return null;
  // Rounded down, so "1 day" means at least a day remains rather than an hour.
  const days = Math.floor((at - now) / 86_400_000);
  return { days, warn: days <= LAPSE_WARNING_DAYS };
}

/** What to tell the user, or null when there is nothing worth saying yet. */
export function describeLapse(lapse: Lapse | null): string | null {
  if (!lapse || !lapse.warn) return null;
  if (lapse.days < 0) {
    return 'Remote access has lapsed because this phone has not been on your home network. Connect to it to restore remote access.';
  }
  if (lapse.days === 0) {
    return 'Remote access lapses today unless this phone connects to your home network.';
  }
  const days = lapse.days === 1 ? '1 day' : `${lapse.days} days`;
  return `Remote access lapses in ${days} unless this phone connects to your home network.`;
}
