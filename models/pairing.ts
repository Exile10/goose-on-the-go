/**
 * Pairing payload — decoded from the QR code shown on Goose In A Pond desktop.
 *
 * Desktop encodes: pond://pair?host=<hostname>.local&port=<port>&code=<6-digit>
 * plus an optional &ip=<lan-address> (pond-desktop/src/sections/Pairing.tsx),
 * refreshing it as the code expires.
 *
 * Both addresses are present because neither works everywhere. The mDNS name is
 * the better identifier — it survives a DHCP lease change — but Android's
 * resolver does no mDNS, so `<host>.local` fails outright there. Older ponds
 * send no `ip` at all, which is why it is optional rather than required.
 *
 * The code is a short-lived secret proved via the two-phase handshake
 * (see `PondApiClient.pair` in services/api-client.ts) — it is never sent over
 * the wire, and must never be logged either.
 */

export interface PairingPayload {
  /** Base URL of the pond server, e.g. http://gooses-mac.local:4000 */
  serverUrl: string;
  /**
   * The same server by its LAN address, when the QR carried one.
   *
   * Tried only after `serverUrl` fails to answer: the hostname is the better
   * one to keep, and an address baked into a QR goes stale on the next DHCP
   * lease.
   */
  fallbackUrl?: string;
  /** Hostname the hub is advertised as (for display) */
  host: string;
  /** Single-use 6-digit pairing code */
  code: string;
}

export class InvalidPairingCodeError extends Error {
  constructor() {
    super('This QR code isn’t a valid Goose In A Pond pairing code.');
    this.name = 'InvalidPairingCodeError';
  }
}

/**
 * Does this look like a Matter device's setup code rather than a pairing code?
 *
 * Two different QR codes are in play and they are easy to confuse: the Pond's
 * dashboard shows one to pair a phone, and every Matter device ships with one
 * to commission it. Scanning the device's code here is a reasonable mistake,
 * and "that is not a pairing code" is an unhelpful answer to it — the user is
 * holding a code that is perfectly valid somewhere else in the app.
 *
 * This recognises the shapes the Matter controller accepts: the `MT:` QR
 * payload, and the 11- or 21-digit manual codes printed beside it. It exists to
 * pick the right sentence, so it is deliberately loose — the controller remains
 * the authority on what actually decodes.
 */
export function looksLikeMatterSetupCode(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.startsWith('MT:')) return trimmed.length > 3;
  return /^\d{11}$|^\d{21}$/.test(trimmed.replace(/[\s-]/g, ''));
}

/** Parses raw QR code text into a pairing payload. Throws `InvalidPairingCodeError` if malformed. */
export function parsePairingPayload(raw: string): PairingPayload {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new InvalidPairingCodeError();
  }

  const host = url.searchParams.get('host');
  const port = url.searchParams.get('port');
  const code = url.searchParams.get('code');
  if (url.protocol !== 'pond:' || !host || !port || !code) {
    throw new InvalidPairingCodeError();
  }
  // The wizard's manual entry enforces six digits, and a scanned code takes the
  // same handshake — so it is checked in the same place rather than only where
  // someone types it.
  if (!/^\d{6}$/.test(code)) {
    throw new InvalidPairingCodeError();
  }

  const ip = url.searchParams.get('ip');
  return {
    serverUrl: `http://${host}:${port}`,
    fallbackUrl: ip ? `http://${ip}:${port}` : undefined,
    host,
    code,
  };
}
