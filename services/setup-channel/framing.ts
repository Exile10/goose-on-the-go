/**
 * The setup channel's framing (goose-in-a-pond `docs/architecture/pond-setup-channel.md`,
 * "Framing"): one JSON object, its UTF-8 length as four big-endian bytes before it, split across
 * BLE writes or notifications of at most `ATT_MTU - 3` bytes each.
 */

import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js';

/** The largest message either side will take; a longer length closes the session. */
export const MAX_MESSAGE_BYTES = 16 * 1024;
const LENGTH_BYTES = 4;

/** A frame the other side should never have sent. The session closes on it, as the Pond's does. */
export class FramingError extends Error {
  readonly problem: 'too_long' | 'overrun' | 'not_json';

  constructor(problem: FramingError['problem']) {
    super(`setup channel framing: ${problem}`);
    this.name = 'FramingError';
    this.problem = problem;
  }
}

/** One message as it goes on the wire: its length, then its JSON. */
export function encodeFrame(message: object): Uint8Array {
  const body = utf8ToBytes(JSON.stringify(message));
  if (body.length > MAX_MESSAGE_BYTES) throw new FramingError('too_long');
  const out = new Uint8Array(LENGTH_BYTES + body.length);
  new DataView(out.buffer).setUint32(0, body.length, false);
  out.set(body, LENGTH_BYTES);
  return out;
}

/** `bytes` cut into writes of at most `size`, in order. */
export function chunk(bytes: Uint8Array, size: number): Uint8Array[] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('chunk size must be a positive integer');
  const out: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += size) out.push(bytes.subarray(at, Math.min(at + size, bytes.length)));
  return out;
}

/**
 * Reassembles notifications into whole messages. Each side sends one message's chunks before the
 * next message's, so a chunk that runs past the end of its frame is refused rather than read on.
 */
export class FrameReader {
  private header = new Uint8Array(LENGTH_BYTES);
  private headerHave = 0;
  private body: Uint8Array | null = null;
  private bodyHave = 0;

  /** Feed one notification; returns each message it completed, parsed. */
  push(bytes: Uint8Array): unknown[] {
    const done: unknown[] = [];
    let at = 0;
    while (at < bytes.length) {
      if (!this.body) {
        const take = Math.min(LENGTH_BYTES - this.headerHave, bytes.length - at);
        this.header.set(bytes.subarray(at, at + take), this.headerHave);
        this.headerHave += take;
        at += take;
        if (this.headerHave < LENGTH_BYTES) break;
        const length = new DataView(this.header.buffer).getUint32(0, false);
        if (length > MAX_MESSAGE_BYTES) throw new FramingError('too_long');
        this.body = new Uint8Array(length);
        this.bodyHave = 0;
      }
      const take = Math.min(this.body.length - this.bodyHave, bytes.length - at);
      this.body.set(bytes.subarray(at, at + take), this.bodyHave);
      this.bodyHave += take;
      at += take;
      if (this.bodyHave === this.body.length) {
        done.push(parse(this.body));
        this.reset();
        if (at < bytes.length) throw new FramingError('overrun');
      }
    }
    return done;
  }

  /** Whether part of a message has arrived and the rest has not. */
  get midMessage(): boolean {
    return this.headerHave > 0;
  }

  reset(): void {
    this.headerHave = 0;
    this.body = null;
    this.bodyHave = 0;
  }
}

function parse(body: Uint8Array): unknown {
  try {
    const value: unknown = JSON.parse(bytesToUtf8(body));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw new FramingError('not_json');
  }
}
