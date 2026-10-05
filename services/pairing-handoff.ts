/**
 * Carries a scanned credential from the scanner screen back to the screen that
 * asked for it: a Pond pairing payload to the wizard, or a Matter setup code to
 * the commissioning screen.
 *
 * Expo Router has no return value for a pushed screen, and the obvious
 * alternative — route params — would put a live pairing code in the URL. On web
 * that lands in browser history, and the code is a credential: it is the secret
 * the HMAC proves possession of, which is precisely why the protocol never puts
 * it on the wire.
 *
 * A Matter setup code is the same kind of secret and gets the same treatment:
 * the Pond redacts it on both sides of its own protocol, so it has no business
 * in a URL either.
 *
 * So the payload is held here for exactly one read. `take()` clears it, which
 * means a stale scan cannot be picked up by a later visit to the wizard, and the
 * code does not sit in memory after the step that needed it.
 *
 * One slot per kind, and each `take` is typed. Sharing a slot would let a Matter
 * scan be read as a Pond payload by whichever screen happened to look first,
 * which is a mix-up the compiler can rule out instead.
 */

import type { PairingPayload } from '@/models/pairing';

let pending: PairingPayload | null = null;

/** Hand a freshly scanned payload to whoever reads next. */
export function offerPairingPayload(payload: PairingPayload): void {
  pending = payload;
}

/** Take the pending payload, clearing it. Returns null when there is none. */
export function takePairingPayload(): PairingPayload | null {
  const held = pending;
  pending = null;
  return held;
}

let pendingSetupCode: string | null = null;

/** Hand a freshly scanned Matter setup code to whoever reads next. */
export function offerSetupCode(code: string): void {
  pendingSetupCode = code;
}

/** Take the pending setup code, clearing it. Returns null when there is none. */
export function takeSetupCode(): string | null {
  const held = pendingSetupCode;
  pendingSetupCode = null;
  return held;
}

/**
 * Where the welcome screen left the wizard to begin: at a Pond it found on the
 * network, or at the address form. Without it the wizard opened on its own search,
 * so a household that had just picked its Pond was shown the same list again.
 *
 * Held here rather than in route params for the reason above, and one more: a
 * route param can arrive from any `gooseonthego://` link, which would let a web
 * page open the wizard with an address and a pin of its choosing already filled.
 * The pin is only ever a claim the next step has the user check, but it should
 * not be possible to plant one.
 */
export type PairingStart = { kind: 'pond'; url: string; pin?: string } | { kind: 'address' };

let pendingStart: PairingStart | null = null;

/** Hand the wizard where to begin, for the next time it opens. */
export function offerPairingStart(start: PairingStart): void {
  pendingStart = start;
}

/**
 * Read where to begin without clearing it.
 *
 * A state initialiser can run twice under React's strict mode, and a take() there
 * would hand the second call nothing. The wizard reads with this and clears with
 * clearPairingStart once it has mounted.
 */
export function peekPairingStart(): PairingStart | null {
  return pendingStart;
}

/** Forget where to begin, so a later visit to the wizard starts with its search. */
export function clearPairingStart(): void {
  pendingStart = null;
}
