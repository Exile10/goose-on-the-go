/**
 * Waiting to be let in by a locked Pond. The phone proved its code and was given a request; it
 * comes back for the answer every three seconds until the main member accepts or declines, or
 * the request runs out. The request's secret stays in memory and is never logged.
 */

import { heldUntil, type HeldPairing } from '@/models/pairing-lock';

import { ApiError, type HandshakeResponse, type PairingClaim } from './api-client';

export const CLAIM_EVERY_MS = 3_000;

export type HeldOutcome =
  | { status: 'paired'; response: HandshakeResponse }
  | { status: 'declined' }
  /** The Pond let the request go, or it ran out while the phone waited. */
  | { status: 'gone' }
  /** The Pond answered, and not about the request: off its network, or a Pond without the route. */
  | { status: 'refused'; error: ApiError }
  /** The wait was given up from this side. */
  | { status: 'stopped' };

export interface HeldWait {
  claim: (held: HeldPairing) => Promise<PairingClaim>;
  now?: () => number;
  /** Resolves after `ms`, or as soon as `signal` aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

/** Ask until answered. One request in flight at a time, never sooner than three seconds after the last. */
export async function waitForPairing(held: HeldPairing, deps: HeldWait, signal: AbortSignal): Promise<HeldOutcome> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? pause;
  const until = heldUntil(held, now());
  for (;;) {
    if (signal.aborted) return { status: 'stopped' };
    if (now() >= until) return { status: 'gone' };
    let wait = CLAIM_EVERY_MS;
    try {
      const claim = await deps.claim(held);
      if (signal.aborted) return { status: 'stopped' };
      if (claim.status !== 'waiting') return claim;
    } catch (e) {
      if (signal.aborted) return { status: 'stopped' };
      if (e instanceof ApiError && e.status === 429) {
        wait = Math.max(wait, (e.retryAfterSecs ?? 0) * 1000);
      } else if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        return { status: 'refused', error: e };
      }
      // No answer, or a Pond in trouble, says nothing about the request: it is asked again.
    }
    await sleep(wait, signal);
  }
}
