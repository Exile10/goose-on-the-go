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
