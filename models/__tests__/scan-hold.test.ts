/**
 * The hold rule, exercised without a camera.
 *
 * Every one of these was previously only observable by pointing a phone at a
 * QR code, which is how a hold that did not hold reached a device.
 */

import { advanceHold, HOLD_STEADY_MS, LOST_AFTER_MS, type Hold } from '@/models/scan-hold';

const CODE = 'pond://pair?host=nano.local&port=8080&code=123456';

/** Feed a run of frames at a fixed spacing, starting from `t0`. */
function runFrames(
  frames: { data?: string; at: number }[],
  start: Hold | null = null,
): { hold: Hold | null; acceptedAt: number | null } {
  let hold = start;
  let acceptedAt: number | null = null;
  for (const frame of frames) {
    const step = advanceHold(hold, frame.data ?? CODE, frame.at);
    hold = step.hold;
    if (step.accept && acceptedAt === null) acceptedAt = frame.at;
  }
  return { hold, acceptedAt };
}

describe('advanceHold', () => {
  it('never accepts on the first sighting', () => {
    // The bug this exists to prevent: a QR passing through the lens paired the
    // phone before the user had finished aiming.
    expect(advanceHold(null, CODE, 1_000).accept).toBe(false);
  });

  it('does not accept before the hold has elapsed', () => {
    const frames = [];
    for (let at = 0; at < HOLD_STEADY_MS; at += 100) frames.push({ at });

    expect(runFrames(frames).acceptedAt).toBeNull();
  });

  it('accepts once the same code has been held for the full window', () => {
    const frames = [];
    for (let at = 0; at <= HOLD_STEADY_MS; at += 100) frames.push({ at });

    expect(runFrames(frames).acceptedAt).toBe(HOLD_STEADY_MS);
  });

  it('restarts the hold when a different code enters the frame', () => {
    const other = 'pond://pair?host=other.local&port=4000&code=654321';
    const frames = [
      { at: 0 },
      { at: 300 },
      { data: other, at: 600 },
      { at: 900 }, // back to the first code: a fresh hold, not a completed one
    ];

    const { acceptedAt, hold } = runFrames(frames);
    expect(acceptedAt).toBeNull();
    expect(hold).toMatchObject({ data: CODE, since: 900 });
  });

  it('restarts when the code was out of frame longer than the gap allows', () => {
    // Glance, look away, glance again. Two brief sightings must not add up to a
    // deliberate hold.
    const frames = [{ at: 0 }, { at: 100 }, { at: 100 + LOST_AFTER_MS + 1 }];

    const { acceptedAt, hold } = runFrames(frames);
    expect(acceptedAt).toBeNull();
    expect(hold).toMatchObject({ since: 100 + LOST_AFTER_MS + 1 });
  });

  it('tolerates a gap inside the allowance without restarting', () => {
    // A dropped frame or two is normal and must not punish a steady hand, so
    // long as no single gap exceeds the allowance.
    // Gaps of 300, 300 and 100 ms, none of them past LOST_AFTER_MS.
    const frames = [{ at: 0 }, { at: 300 }, { at: 600 }, { at: HOLD_STEADY_MS }];

    expect(runFrames(frames).acceptedAt).toBe(HOLD_STEADY_MS);
  });

  it('keeps accepting on later frames, so the caller owns stopping', () => {
    // The rule is not one-shot; the screen disables scanning on accept. Stating
    // it here so a future caller does not assume the rule de-bounces for it.
    const held: Hold = { data: CODE, since: 0, lastSeen: HOLD_STEADY_MS };
    expect(advanceHold(held, CODE, HOLD_STEADY_MS + 50).accept).toBe(true);
  });
});
