/**
 * Sealing on the setup channel (pond-setup-channel.md, "Sealing"). There is no TLS over BLE, so once
 * CPace has run, every message is ChaCha20-Poly1305 under a key drawn from its ISK: one key per
 * direction, a counter nonce per message, and no associated data.
 */

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js';
import { expand, extract } from '@noble/hashes/hkdf.js';
import { sha512 } from '@noble/hashes/sha2.js';

export const POND_TO_PHONE_INFO = 'goose-setup-channel-v1 pond to phone';
export const PHONE_TO_POND_INFO = 'goose-setup-channel-v1 phone to pond';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;

/** A sealed message that does not open, or opens out of order. The session closes on it. */
export class SealingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealingError';
  }
}

export interface ChannelKeys {
  pondToPhone: Uint8Array;
  phoneToPond: Uint8Array;
}

/** HKDF-SHA-512 over ISK, salted with sid, expanded once per direction. */
export function channelKeys(isk: Uint8Array, sid: Uint8Array): ChannelKeys {
  const prk = extract(sha512, isk, sid);
  const keys = {
    pondToPhone: expand(sha512, prk, utf8ToBytes(POND_TO_PHONE_INFO), KEY_BYTES),
    phoneToPond: expand(sha512, prk, utf8ToBytes(PHONE_TO_POND_INFO), KEY_BYTES),
  };
  prk.fill(0);
  return keys;
}

/** Four zero bytes, then the counter as eight big-endian bytes. */
export function counterNonce(counter: number): Uint8Array {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new SealingError('counter out of range');
  const nonce = new Uint8Array(NONCE_BYTES);
  const view = new DataView(nonce.buffer);
  view.setUint32(4, Math.floor(counter / 2 ** 32), false);
  view.setUint32(8, counter >>> 0, false);
  return nonce;
}

/** One direction's key and the counter it has reached; each seal or open spends one. */
export class SealedDirection {
  private next: number;

  constructor(private readonly key: Uint8Array, start = 0) {
    if (key.length !== KEY_BYTES) throw new SealingError('a channel key is 32 bytes');
    this.next = start;
  }

  get counter(): number {
    return this.next;
  }

  seal(plaintext: Uint8Array): Uint8Array {
    return chacha20poly1305(this.key, counterNonce(this.next++)).encrypt(plaintext);
  }

  /** A tag that fails is refused, and the counter does not move, since the session is over. */
  open(ciphertext: Uint8Array): Uint8Array {
    let plain: Uint8Array;
    try {
      plain = chacha20poly1305(this.key, counterNonce(this.next)).decrypt(ciphertext);
    } catch {
      throw new SealingError('a sealed message did not open');
    }
    this.next++;
    return plain;
  }

  destroy(): void {
    this.key.fill(0);
  }
}

/** `{"sealed": "<base64>"}` around `message`'s JSON. */
export function sealMessage(direction: SealedDirection, message: object): { sealed: string } {
  return { sealed: toBase64(direction.seal(utf8ToBytes(JSON.stringify(message)))) };
}

/** The JSON object inside an envelope, or a {@link SealingError} for anything else. */
export function openMessage(direction: SealedDirection, envelope: unknown): Record<string, unknown> {
  const sealed = (envelope as { sealed?: unknown } | null)?.sealed;
  if (typeof sealed !== 'string') throw new SealingError('expected a sealed message');
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(sealed);
  } catch {
    throw new SealingError('a sealed message is not base64');
  }
  const plain = direction.open(bytes);
  let value: unknown;
  try {
    value = JSON.parse(bytesToUtf8(plain));
  } catch {
    throw new SealingError('a sealed message is not JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new SealingError('a sealed message is not an object');
  return value as Record<string, unknown>;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Standard base64 only; throws on anything else. */
export function fromBase64(b64: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) throw new Error('not standard base64');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
