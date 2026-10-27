/**
 * When a conversation offers the way back to its newest message.
 *
 * The thread is an inverted list, so the scroll offset is already the distance
 * from the newest message: zero at the foot of the thread, growing as the
 * reader goes back in it.
 *
 * Two thresholds rather than one, so the button does not flicker at the
 * boundary while a reader drifts around it:
 *
 * - **Shown past one and a half screens.** Within one screen the newest message
 *   is still on screen or a short flick away, and a button would only cover
 *   the thread. Past one and a half, the newest message is a full screen out of
 *   view, which is where the reader can no longer tell how far the bottom is.
 *   A fixed offset would mean a different amount of reading on a small phone
 *   and a tablet; a share of the screen means the same amount on both.
 * - **Hidden within half a screen.** Near the foot the newest message is in
 *   view again, so the button has nothing left to offer.
 *
 * Between the two the button keeps whichever state it had.
 *
 * `hasUnseen` is the hint on the button that the thread moved while the reader
 * was away from its foot: a new message, or a reply still being written. It is
 * derived from where the foot was when the button appeared rather than set as
 * things arrive, so a streaming reply costs nothing per token. It only ever
 * arises while the button is showing, and goes with it.
 *
 * Pure, so the thresholds can be tested without a list.
 */

import type { Message } from '@/models/chat';

/** Screens of thread between the reader and the newest message before the button appears. */
export const SHOW_AFTER_SCREENS = 1.5;

/** Screens from the newest message within which the button goes again. */
export const HIDE_WITHIN_SCREENS = 0.5;

/**
 * How close to the foot, in points, a reader still counts as following the
 * thread: a new message or a growing reply carries them along. Further back
 * the list holds what they are reading where it is instead. A few lines of
 * text, so a reader resting a hair above the foot, as an overscroll leaves
 * them, is not taken for one who went back to reread.
 */
export const FOLLOW_WITHIN_PT = 64;

/** Whether a reader at `offset` (the inverted list's) has gone back in the thread. */
export function isBackInThread(offset: number): boolean {
  return offset > FOLLOW_WITHIN_PT;
}

/**
 * The list's `maintainVisibleContentPosition`: only while the reader is back in
 * the thread. Held at the foot as well, a message added there moved the list by
 * its own height to keep the row before it still, so the message the reader had
 * just sent sat below the list with only its top edge showing (A57, 2026-10-27);
 * `autoscrollToTopThreshold` did not bring it back on Android's inverted list. At
 * the foot an inverted list stays on the newest row by itself, so it needs no
 * holding there.
 */
export function holdPlace(back: boolean): { minIndexForVisible: number } | undefined {
  return back ? { minIndexForVisible: 0 } : undefined;
}

export interface LatestButton {
  visible: boolean;
  /**
   * The foot of the thread when the button appeared (`footKey`). The hint shows
   * once the foot is anything else.
   */
  seenFoot: string;
}

export const HIDDEN: LatestButton = { visible: false, seenFoot: '' };

/**
 * Where the foot of the thread has got: its newest message, and how far that
 * message has been written. It changes when a message lands and as a reply
 * streams, and not otherwise.
 */
export function footKey(newest: Pick<Message, 'id' | 'content' | 'tools'> | undefined): string {
  return newest ? `${newest.id}:${newest.content.length}:${newest.tools?.length ?? 0}` : '';
}

/**
 * The button after a scroll. `offset` is the inverted list's offset, which is
 * the distance from the newest message; `viewport` is the list's own height;
 * `foot` is the thread's `footKey` now. Before the list has a height there is
 * nothing to measure against, and the button stays hidden.
 */
export function afterScroll(
  state: LatestButton,
  offset: number,
  viewport: number,
  foot: string,
): LatestButton {
  if (!(viewport > 0)) return HIDDEN;
  if (offset <= viewport * HIDE_WITHIN_SCREENS) return HIDDEN;
  if (offset > viewport * SHOW_AFTER_SCREENS && !state.visible) return { visible: true, seenFoot: foot };
  return state;
}

/**
 * Whether the thread moved at its foot since the button appeared. A reader at
 * the foot sees the move for themselves; one scrolled away is told by the hint.
 */
export function hasUnseen(state: LatestButton, foot: string): boolean {
  return state.visible && state.seenFoot !== foot;
}
