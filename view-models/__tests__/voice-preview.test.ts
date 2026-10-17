/**
 * The face is driven by the clip's loudness at the playhead; scaled wrong, it either never moves or
 * sits pinned at full, which is what raw RMS and double scaling each do.
 */

import { levelAt, PREVIEW_LINES } from '@/view-models/use-voice-preview';
import i18n from '@/services/i18n';

const lookup = i18n.t as unknown as (key: string) => string;

describe('the level the face is given', () => {
  it('reads the window under the playhead and scales it as the desktop does', () => {
    // 0.05 RMS: three times for the hook, six times for the orb.
    expect(levelAt([0, 0.05, 0.2], 30, 0.04)).toBeCloseTo(0.9);
  });

  it('holds the last window past the end of the clip, and rests on silence', () => {
    expect(levelAt([0.01, 0.02], 30, 9)).toBeCloseTo(0.36);
    expect(levelAt([], 30, 1)).toBe(0);
  });

  it('never goes past full', () => {
    expect(levelAt([1], 30, 0)).toBe(1);
  });
});

it('has every preview line it cycles through', () => {
  expect(PREVIEW_LINES.filter((key) => lookup(key) === key)).toEqual([]);
});
