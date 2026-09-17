/**
 * Deciding when a scanned QR has been held long enough to act on.
 *
 * The scanner used to commit on the first frame that decoded, so a code merely
 * passing through the lens paired the phone before the user had finished aiming.
 * That read is not wrong — QR carries its own error correction, so a decode is
 * either correct or does not happen — it is simply not yet a decision the user
 * has made.
 *
 * This lives apart from the screen, and is pure, because the alternative was
 * untestable: the only way to exercise a rule embedded in a camera callback is
 * to point a real phone at a real QR, which is exactly the loop that let a
 * broken hold reach a device. Given a frame's timestamp it answers with the next
 * state and whether to accept, and that can be asserted in milliseconds.
 */

/** How long the same code must stay readable before it is accepted. */
export const HOLD_STEADY_MS = 700;

/**
 * A gap longer than this means the code left the frame, and the hold restarts.
 *
 * `onBarcodeScanned` has no "lost" event — it simply stops firing — so the gap
 * between frames is the only evidence available. Deriving it from the timestamps
 * rather than from a timer keeps the rule in one place and keeps it pure.
 */
export const LOST_AFTER_MS = 350;

/** A code currently being held, and when the hold began. */
export interface Hold {
  data: string;
  /** When this uninterrupted run of the same code started. */
  since: number;
  /** When it was last seen, used to notice it leaving the frame. */
  lastSeen: number;
}

export interface HoldStep {
  hold: Hold;
  /** True exactly once, on the frame that completes the hold. */
  accept: boolean;
}

/**
 * Fold one decoded frame into the hold.
 *
 * Restarts whenever the code changes or the previous sighting is stale, and
 * accepts once the same code has been seen continuously for `HOLD_STEADY_MS`.
 */
export function advanceHold(previous: Hold | null, data: string, now: number): HoldStep {
  const interrupted =
    !previous || previous.data !== data || now - previous.lastSeen > LOST_AFTER_MS;

  if (interrupted) {
    return { hold: { data, since: now, lastSeen: now }, accept: false };
  }

  return {
    hold: { ...previous, lastSeen: now },
    accept: now - previous.since >= HOLD_STEADY_MS,
  };
}
