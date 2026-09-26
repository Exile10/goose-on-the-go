/**
 * Pure-JS HMAC-SHA256 used by the GIAP pairing handshake.
 *
 * The pairing-code is the HMAC key, the message is `challenge || client_id`.
 * Output is the lowercase hex MAC the server expects in /handshake/verify.
 *
 * Implementation is byte-for-byte standard FIPS 180-4 + RFC 2104, with no
 * dependency on Web Crypto (which is uneven across React Native versions).
 */

function rotr(n: number, x: number): number {
  return (x >>> n) | (x << (32 - n));
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256(bytes: Uint8Array): Uint8Array {
  // Padding
  const l = bytes.length;
  const bitLen = l * 8;
  const padded = new Uint8Array(((l + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[l] = 0x80;
  // 64-bit big-endian length in last 8 bytes
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, hi, false);
  dv.setUint32(padded.length - 4, lo, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(7, w[t - 15]) ^ rotr(18, w[t - 15]) ^ (w[t - 15] >>> 3);
      const s1 = rotr(17, w[t - 2]) ^ rotr(19, w[t - 2]) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => odv.setUint32(i * 4, v, false));
  return out;
}

const BLOCK = 64;

export function hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array {
  let k = key;
  if (k.length > BLOCK) k = sha256(k);
  if (k.length < BLOCK) {
    const padded = new Uint8Array(BLOCK);
    padded.set(k);
    k = padded;
  }
  const oKey = new Uint8Array(BLOCK);
  const iKey = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) {
    oKey[i] = k[i] ^ 0x5c;
    iKey[i] = k[i] ^ 0x36;
  }
  const inner = new Uint8Array(BLOCK + msg.length);
  inner.set(iKey);
  inner.set(msg, BLOCK);
  const innerHash = sha256(inner);
  const outer = new Uint8Array(BLOCK + innerHash.length);
  outer.set(oKey);
  outer.set(innerHash, BLOCK);
  return sha256(outer);
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

export function fromBase64(b64: string): Uint8Array {
  // RN >= 0.71 has globalThis.atob.
  const bin = (globalThis as any).atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** Label for the MAC this client sends. Must match the Pond's `CLIENT_LABEL`. */
export const CLIENT_LABEL = 'goose-pair-client-v1';
/** Label for the proof the Pond sends back. Must match its `SERVER_LABEL`. */
export const SERVER_LABEL = 'goose-pair-server-v1';

/**
 * The bytes a pairing MAC is computed over, keyed by the pairing code.
 *
 * Two shapes, selected by whether this connection had a certificate to bind to:
 *
 *   bound     label | 0x00 | challenge | 0x00 | clientId | 0x00 | spki
 *   unbound   challenge | clientId
 *
 * The unbound shape is the original and is kept byte-for-byte, for a Pond
 * running a server older than the binding. `0x00` separates the bound fields
 * unambiguously: `clientId` and the pin are text and cannot contain a NUL, and
 * the challenge is a fixed 32 bytes. The label is inside the MAC rather than
 * beside it so the two directions cannot be replayed against each other -- a
 * server proof is not a client MAC.
 *
 * Kept here beside `hmacSha256` rather than in the api client, because the Pond
 * computes the same bytes in `sqlite_handshake.rs :: pair_mac` and the two
 * definitions have to be findable together.
 */
export function pairTranscript(
  label: string,
  challenge: Uint8Array,
  clientId: string,
  spki?: string,
): Uint8Array {
  if (!spki) return concat(challenge, utf8(clientId));
  const nul = new Uint8Array([0]);
  return concat(
    concat(concat(utf8(label), nul), concat(challenge, nul)),
    concat(concat(utf8(clientId), nul), utf8(spki)),
  );
}

/**
 * Compare two hex MACs without leaking where they first differ.
 *
 * The threat is thin -- each wrong guess burns a challenge and a pairing code --
 * but a length-and-XOR compare costs nothing next to the HMAC that produced the
 * values.
 */
export function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
