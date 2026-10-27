/**
 * When a conversation offers the way back to its newest message, and when it
 * says the thread moved while the reader was away.
 */

import type { Message } from '@/models/chat';
import {
  FOLLOW_WITHIN_PT,
  HIDDEN,
  HIDE_WITHIN_SCREENS,
  SHOW_AFTER_SCREENS,
  afterScroll,
  footKey,
  hasUnseen,
  holdPlace,
  isBackInThread,
  type LatestButton,
} from '@/view-models/latest-button';

const SCREEN = 800;
const FOOT = 'm9:40:0';
const shown: LatestButton = { visible: true, seenFoot: FOOT };

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm9',
  role: 'assistant',
  content: 'x'.repeat(40),
  timestamp: 0,
  ...over,
});

describe('afterScroll', () => {
  it('stays hidden at the foot of the thread and within the first screen and a half', () => {
    expect(afterScroll(HIDDEN, 0, SCREEN, FOOT)).toEqual(HIDDEN);
    expect(afterScroll(HIDDEN, SCREEN, SCREEN, FOOT)).toEqual(HIDDEN);
    expect(afterScroll(HIDDEN, SCREEN * SHOW_AFTER_SCREENS, SCREEN, FOOT)).toEqual(HIDDEN);
  });

  it('appears once the reader is more than a screen and a half back, noting where the foot was', () => {
    expect(afterScroll(HIDDEN, SCREEN * SHOW_AFTER_SCREENS + 1, SCREEN, FOOT)).toEqual(shown);
  });

  it('measures in screens, so a taller list needs a longer scroll', () => {
    expect(afterScroll(HIDDEN, 1300, 800, FOOT).visible).toBe(true);
    expect(afterScroll(HIDDEN, 1300, 1200, FOOT).visible).toBe(false);
  });

  it('keeps its state between the two thresholds, so it does not flicker at either', () => {
    expect(afterScroll(shown, SCREEN, SCREEN, FOOT)).toBe(shown);
    expect(afterScroll(HIDDEN, SCREEN, SCREEN, FOOT)).toBe(HIDDEN);
  });

  it('goes once the reader is back within half a screen of the newest message', () => {
    expect(afterScroll(shown, SCREEN * HIDE_WITHIN_SCREENS, SCREEN, FOOT)).toEqual(HIDDEN);
    expect(afterScroll(shown, 0, SCREEN, 'later')).toEqual(HIDDEN);
  });

  it('keeps the foot it first saw while the reader stays back, so the hint survives scrolling', () => {
    expect(afterScroll(shown, SCREEN * 3, SCREEN, 'later')).toBe(shown);
  });

  it('stays hidden before the list has a height to measure against', () => {
    expect(afterScroll(HIDDEN, 5000, 0, FOOT)).toEqual(HIDDEN);
    expect(afterScroll(shown, 5000, Number.NaN, FOOT)).toEqual(HIDDEN);
  });
});

describe('hasUnseen', () => {
  it('says nothing while the button is hidden: a reader at the foot saw it happen', () => {
    expect(hasUnseen(HIDDEN, 'anything')).toBe(false);
  });

  it('says nothing while the foot is where it was when the button appeared', () => {
    expect(hasUnseen(shown, FOOT)).toBe(false);
  });

  it('marks the button once the foot moves behind a reader who is back in the thread', () => {
    expect(hasUnseen(shown, 'm9:41:0')).toBe(true);
    expect(hasUnseen(shown, 'm10:0:0')).toBe(true);
  });
});

describe('footKey', () => {
  it('moves when a message lands, as a reply streams, and as it calls a tool', () => {
    const base = footKey(message());
    expect(base).toBe(FOOT);
    expect(footKey(message({ id: 'm10' }))).not.toBe(base);
    expect(footKey(message({ content: 'x'.repeat(41) }))).not.toBe(base);
    expect(
      footKey(message({ tools: [{ id: 'c1', name: 't', args: '{}', status: 'running' }] })),
    ).not.toBe(base);
  });

  it('holds still when nothing at the foot changed, and is empty for an empty thread', () => {
    expect(footKey(message())).toBe(footKey(message({ timestamp: 99 })));
    expect(footKey(undefined)).toBe('');
  });
});

describe('holding the reader\'s place', () => {
  it('counts a reader within a few lines of the foot as following the thread', () => {
    expect(isBackInThread(0)).toBe(false);
    expect(isBackInThread(FOLLOW_WITHIN_PT)).toBe(false);
    expect(isBackInThread(FOLLOW_WITHIN_PT + 1)).toBe(true);
  });

  it('holds the place only for a reader back in the thread', () => {
    expect(holdPlace(true)).toEqual({ minIndexForVisible: 0 });
  });

  it('does not hold the place at the foot, so a message just sent stays in view', () => {
    expect(holdPlace(false)).toBeUndefined();
  });
});
