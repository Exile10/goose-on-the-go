/**
 * What the app is allowed to say when a Pond request fails.
 *
 * Four view-models had grown the same fallback independently, and it ended in
 * `Your Pond refused the request (HTTP 401).` on screen. A status code is for a
 * log: it tells the reader that something is wrong and nothing they can do
 * about it, and 401 in particular was being shown directly under a banner that
 * had already explained the situation in words.
 *
 * So the number stays out of the UI. Each caller keeps the statuses that mean
 * something specific to it and delegates the rest here.
 */

import { ApiError } from '@/services/api-client';

/** The shared reading of a failed request, in words rather than a code. */
export function describeApiError(e: unknown): string {
  if (!(e instanceof ApiError)) {
    return 'Could not reach your Pond. Check that it is running on this network.';
  }
  // The revoked case. The connection banner says the same thing and offers the
  // way out, so this is deliberately the same sentence rather than a second,
  // differently-worded account of one situation.
  if (e.status === 401 || e.status === 403) {
    return 'Your Pond is no longer accepting this phone. Pair again at home.';
  }
  if (e.isRetryable) return 'Your Pond is busy. Try again in a moment.';
  return 'Your Pond could not complete that request.';
}
