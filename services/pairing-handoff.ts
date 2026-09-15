/**
 * Carries a scanned pairing payload from the scanner screen back to the wizard.
 *
 * Expo Router has no return value for a pushed screen, and the obvious
 * alternative — route params — would put a live pairing code in the URL. On web
 * that lands in browser history, and the code is a credential: it is the secret
 * the HMAC proves possession of, which is precisely why the protocol never puts
 * it on the wire.
 *
 * So the payload is held here for exactly one read. `take()` clears it, which
 * means a stale scan cannot be picked up by a later visit to the wizard, and the
 * code does not sit in memory after the step that needed it.
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
