/**
 * CPace (draft-irtf-cfrg-cpace-21), suite CPACE-RISTR255-SHA512, and the
 * pairing exchange the Pond runs on top of it.
 *
 * The six-digit pairing code, or a setup card's eleven digits, is the password.
 * Nothing either side sends can be tested against a guessed code offline: each
 * guess costs one live exchange with whoever holds the code, so a party that
 * terminates the phone's TLS learns one yes-or-no per pairing attempt instead of
 * the code.
 *
 * Roles: the Pond is the initiator (A) and the phone the responder (B). That is
 * what fits the two existing round trips with the phone confirming first, so the
 * Pond reveals its confirmation only to a phone that has already proven the code.
 *
 * The first half of this file is the draft, held to its Appendix A.1 and B.3
 * vectors (`__tests__/cpace.test.ts`). The second half is this project's glue --
 * channel identifier, session id, key confirmation -- and it is held to the
 * exchange vectors the Pond generates, byte for byte. The Pond's counterpart is
 * `crates/pond-infra/src/pairing_cpace.rs`; the two must be read together.
 *
 * Randomness is a parameter rather than an import so the vectors can fix it.
 * The caller passes `services/secure-random.ts`, which is the platform CSPRNG.
 * Do not substitute noble's own `randomBytes`: it needs a global
 * `crypto.getRandomValues`, which Hermes does not promise.
 */

import { ristretto255, ristretto255_hasher } from '@noble/curves/ed25519.js';
import { bytesToNumberLE, concatBytes, equalBytes } from '@noble/curves/utils.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

type Point = InstanceType<typeof ristretto255.Point>;

/** Draft 8.3: the ristretto255 domain-separation identifier. */
export const DSI = utf8ToBytes('CPaceRistretto255');
/** Draft 8.3: the DSI the ISK hash is keyed by. */
const DSI_ISK = utf8ToBytes('CPaceRistretto255_ISK');
/** SHA-512's input block size, which sets the zero padding in the generator string. */
const S_IN_BYTES = 128;
/** The public encoding of the identity element, G.I. */
const IDENTITY = new Uint8Array(32);

/** A run that must stop: a share that does not decode, or a shared secret that is the identity. */
class CpaceAbort extends Error {
  constructor(message: string) { super(message); this.name = 'CpaceAbort'; }
}

/** Draft A.1.1: `data` prefixed with its length as unsigned LEB128. */
export function prependLen(data: Uint8Array): Uint8Array {
  const length: number[] = [];
  let n = data.length;
  do {
    length.push(n < 128 ? n : (n & 0x7f) | 0x80);
    n >>>= 7;
  } while (n > 0);
  return concatBytes(Uint8Array.from(length), data);
}

/** Draft A.1.3: every argument length-prefixed, then concatenated. */
export function lvCat(...args: Uint8Array[]): Uint8Array {
  return concatBytes(...args.map(prependLen));
}

/**
 * Draft A.2: the string the generator is hashed from.
 *
 * The zero padding fills out the first hash block after DSI and PRS, so the
 * password-dependent state is computed once per block rather than mixed into the
 * same block as the public CI and sid.
 */
export function generatorString(
  dsi: Uint8Array,
  prs: Uint8Array,
  ci: Uint8Array,
  sid: Uint8Array,
  sInBytes: number,
): Uint8Array {
  const zpad = Math.max(0, sInBytes - 1 - prependLen(prs).length - prependLen(dsi).length);
  return lvCat(dsi, prs, new Uint8Array(zpad), ci, sid);
}

/**
 * Draft 8.3 `calculate_generator`: SHA-512 of the generator string, then the
 * RFC 9496 section 4.3.4 element derivation.
 *
 * `deriveToCurve`, not `hashToCurve`. noble's `hashToCurve` is RFC 9380
 * `hash_to_ristretto255`, which runs `expand_message_xmd` first and produces a
 * different point; it fails the draft's B.3.1 vector.
 */
export function calculateGenerator(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array): Point {
  // Optional in noble's shared hasher type, present for ristretto255; checked rather than asserted.
  if (!ristretto255_hasher.deriveToCurve) throw new Error('ristretto255 element derivation is missing');
  return ristretto255_hasher.deriveToCurve(sha512(generatorString(DSI, prs, ci, sid, S_IN_BYTES)));
}

/**
 * Draft 8.3 `sample_scalar`: 32 random bytes with bits 252-255 cleared, read
 * little-endian. Below 2^252, so always below the group order and canonical.
 * Zero is redrawn: it would send the identity, which the peer must refuse.
 */
export function sampleScalar(random: (count: number) => Uint8Array): bigint {
  for (;;) {
    const bytes = random(32);
    bytes[31] &= 0x0f;
    const scalar = bytesToNumberLE(bytes);
    bytes.fill(0);
    if (scalar !== 0n) return scalar;
  }
}

/** Draft 8.3 `scalar_mult`: `encode(y * g)`. */
export function scalarMult(y: bigint, g: Point): Uint8Array {
  return g.multiply(y).toBytes();
}

/**
 * Draft 8.3 `scalar_mult_vfy`: `encode(y * decode(X))`, or the identity's
 * encoding when `X` does not decode. noble's `fromBytes` refuses every
 * non-canonical encoding, which is the decode failure the draft means.
 */
export function scalarMultVfy(y: bigint, x: Uint8Array): Uint8Array {
  let point: Point;
  try { point = ristretto255.Point.fromBytes(x); } catch { return IDENTITY.slice(); }
  // The identity decodes, and any multiple of it is the identity, which the caller
  // refuses. Answered directly so that refusal does not rest on how the library
  // multiplies the identity.
  return point.equals(ristretto255.Point.ZERO) ? IDENTITY.slice() : point.multiply(y).toBytes();
}

/** Draft 6.4 / B.3.5: the initiator-responder ISK. */
export function intermediateSessionKey(
  sid: Uint8Array,
  k: Uint8Array,
  ya: Uint8Array,
  adA: Uint8Array,
  yb: Uint8Array,
  adB: Uint8Array,
): Uint8Array {
  return sha512(concatBytes(lvCat(DSI_ISK, sid, k), lvCat(ya, adA), lvCat(yb, adB)));
}

// ---------------------------------------------------------------------------
// The pairing exchange. Everything below is this project's, not the draft's.
// ---------------------------------------------------------------------------

/** The label that opens the channel identifier. A breaking change to the exchange is a new label. */
export const CI_LABEL = 'goose-pair-cpace-v1';
/** The setup code's own label, so a setup code and a pairing code never share a generator. */
export const SETUP_CI_LABEL = 'goose-setup-cpace-v1';
/** The label inside the phone's confirmation tag. */
export const CLIENT_CONFIRM_LABEL = 'goose-pair-cpace-client-v1';
/** The label inside the Pond's confirmation tag. Different from the phone's, so neither reflects. */
export const SERVER_CONFIRM_LABEL = 'goose-pair-cpace-server-v1';
/** Length of the Pond's challenge and of the phone's nonce, the two halves of sid. */
export const NONCE_BYTES = 32;

/** Both associated-data strings are empty: everything known up front is in CI. */
const NO_AD = new Uint8Array(0);

/**
 * CI: the label, the Pond's public-key pin, and this phone's client id,
 * initiator side first (draft 10.1.1).
 *
 * The pin is the channel binding. The Pond always uses its own; the phone uses
 * the pin it connected under. A party that terminated the phone's TLS with a key
 * of its own therefore runs a different generator from the Pond's, and relaying
 * between the two fails without any check after the run.
 */
export function channelIdentifier(pin: string, clientId: string, label: string = CI_LABEL): Uint8Array {
  return lvCat(utf8ToBytes(label), utf8ToBytes(pin), utf8ToBytes(clientId));
}

/** Which secret the phone holds, as `pake/init` names it: a printed setup card's or a pairing code. */
export type PakeCredential = 'pairing' | 'setup';

/** The label each secret's channel identifier opens with. */
export function channelLabel(credential: PakeCredential): string {
  return credential === 'setup' ? SETUP_CI_LABEL : CI_LABEL;
}

/** Draft 10.4: `mac_key = SHA-512("CPaceMac" || sid || ISK)`. */
export function confirmationKey(sid: Uint8Array, isk: Uint8Array): Uint8Array {
  return sha512(concatBytes(utf8ToBytes('CPaceMac'), sid, isk));
}

/** HMAC-SHA-512 under `macKey` over both shares, opened by the direction's label. */
export function confirmationTag(label: string, macKey: Uint8Array, ya: Uint8Array, yb: Uint8Array): Uint8Array {
  return hmac(sha512, macKey, lvCat(utf8ToBytes(label), ya, NO_AD, yb, NO_AD));
}

/** What the phone sends, and the tag it must see back before trusting the answer. */
export interface CpaceResponse {
  /** Yb, the phone's share. */
  share: Uint8Array;
  /** T_client, the phone's confirmation tag. */
  confirm: Uint8Array;
  /** T_server as the Pond must send it. Compare with {@link confirmationMatches}. */
  expectedServerConfirm: Uint8Array;
  /** sid, `challenge || client_nonce`, which the setup channel salts its keys with. */
  sid: Uint8Array;
  /** ISK, only when asked for: the setup channel seals with keys drawn from it, and the caller zeroes it. */
  isk?: Uint8Array;
}

/**
 * Run the phone's side of one exchange, from the Pond's `init` answer to the
 * `verify` request.
 *
 * `code` is the six digits as typed, or a setup card's eleven without dashes,
 * leading zeros kept, as ASCII. Throws
 * {@link CpaceAbort} when the Pond's share does not decode or the shared secret
 * is the identity; either way nothing is sent.
 */
export function respond(input: {
  code: string;
  pin: string;
  clientId: string;
  /** Absent is a pairing code, as it is on the wire. */
  credential?: PakeCredential;
  challenge: Uint8Array;
  clientNonce: Uint8Array;
  initiatorShare: Uint8Array;
  random: (count: number) => Uint8Array;
  /** Hand ISK back rather than zeroing it, for a run over the setup channel. */
  keepIsk?: boolean;
}): CpaceResponse {
  if (input.challenge.length !== NONCE_BYTES || input.clientNonce.length !== NONCE_BYTES) {
    throw new CpaceAbort('sid halves must be 32 bytes each');
  }
  const sid = concatBytes(input.challenge, input.clientNonce);
  const ci = channelIdentifier(input.pin, input.clientId, channelLabel(input.credential ?? 'pairing'));
  const g = calculateGenerator(utf8ToBytes(input.code), ci, sid);
  const yb = sampleScalar(input.random);
  const share = scalarMult(yb, g);
  const k = scalarMultVfy(yb, input.initiatorShare);
  if (equalBytes(k, IDENTITY)) throw new CpaceAbort('invalid_share');
  const isk = intermediateSessionKey(sid, k, input.initiatorShare, NO_AD, share, NO_AD);
  const macKey = confirmationKey(sid, isk);
  const result: CpaceResponse = {
    share,
    confirm: confirmationTag(CLIENT_CONFIRM_LABEL, macKey, input.initiatorShare, share),
    expectedServerConfirm: confirmationTag(SERVER_CONFIRM_LABEL, macKey, input.initiatorShare, share),
    sid,
    ...(input.keepIsk ? { isk } : {}),
  };
  k.fill(0); macKey.fill(0);
  if (!input.keepIsk) isk.fill(0);
  return result;
}

/** Constant-time comparison of a received tag against the expected one. */
export function confirmationMatches(received: Uint8Array, expected: Uint8Array): boolean {
  return equalBytes(received, expected);
}
