/**
 * What a screen whose content comes from the Pond is in a position to show.
 *
 * Screens used to answer this each on their own, and the answers disagreed. With the Pond
 * unreachable the conversation wall showed a warning notice saying it needed the Pond, a danger
 * notice saying it could not load, and a subtitle saying "Nothing here yet." -- three statements,
 * one of them false -- under a connection banner that had already said all of it. The devices tab
 * showed "No devices yet" for the same failure, because a request that got no answer carried no
 * sentence and so did not count as an error there.
 *
 * One reading, five states, each with one owner:
 *
 * - `loading`: nothing to show yet and a read in flight. The screen's own spinner or ghosts.
 * - `unreachable`: nothing to show, and the connection indicator is already explaining why. The
 *   screen says only that its content will fill in, and never the cause again.
 * - `failed`: nothing to show, the connection is fine, and the read failed anyway. One inline state
 *   with a retry, in place of the content.
 * - `empty`: the read worked and there is nothing. The screen's own empty state, which is never
 *   styled as a failure.
 * - `ready`: there is content. A later read that fails keeps it on screen; the view-model logs it.
 */

export type ContentState = 'loading' | 'unreachable' | 'failed' | 'empty' | 'ready';

/** The four facts the choice is made from. */
export interface ContentStateInputs {
  /** A read is in flight. */
  loading: boolean;
  /** The last read of this content failed. */
  failed: boolean;
  /** There is something to put on screen, from this read or an earlier one. */
  hasContent: boolean;
  /**
   * The connection indicator is up: the Pond cannot be reached, or will not answer this phone.
   * See `connectionNeedsAttention` in `models/connection.ts`.
   */
  disconnected: boolean;
}

/**
 * The order is the policy. Content wins over everything, because a reader who can see their list
 * is better served by it than by news about the request that would have refreshed it. A read in
 * flight comes next, so a cold start that is still bringing the connection up shows a spinner
 * rather than claiming the Pond is gone. Then the connection, because when it is down the read
 * failing says nothing new. Only then is a failure the screen's own news, and only after all of
 * that is "nothing here" a fact rather than a guess.
 */
export function contentState({ loading, failed, hasContent, disconnected }: ContentStateInputs): ContentState {
  if (hasContent) return 'ready';
  if (loading) return 'loading';
  if (disconnected) return 'unreachable';
  if (failed) return 'failed';
  return 'empty';
}

/** Whether `state` is one the shared unavailable view draws, rather than the screen itself. */
export function isUnavailable(state: ContentState): state is 'unreachable' | 'failed' {
  return state === 'unreachable' || state === 'failed';
}
