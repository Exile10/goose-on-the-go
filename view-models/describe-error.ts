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

/**
 * The shared reading of a failed request, in words rather than a code.
 *
 * `null` means there is nothing for the screen to add, because the connection
 * banner is already saying it. That is not a guess: a 401 or 403 that survives
 * the client's one refresh attempt reports the pond as having stopped accepting
 * this phone, which puts the banner into `revoked` -- so by the time a screen
 * is deciding what to render, the sentence is already on top of it. Printing it
 * again underneath is the same fact twice, which is what this used to do.
 *
 * Callers that must always show something -- the pairing wizard, which runs
 * before there is a session to revoke -- supply their own fallback.
 */
export function describeApiError(e: unknown): string | null {
  // Not an ApiError means the request never got an answer, which is a statement
  // about the connection rather than about this screen's operation. The banner
  // already says "Pond is unavailable", and the failure that produced this also
  // drove the recovery that put it there, so a screen repeating it underneath
  // is the same fact twice.
  if (!(e instanceof ApiError)) return null;
  if (e.status === 401 || e.status === 403) return null;
  if (e.isRetryable) return 'Your Pond is busy. Try again in a moment.';
  return 'Your Pond could not complete that request.';
}
