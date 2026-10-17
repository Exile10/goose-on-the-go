/**
 * Sealing, checked against Node's own HKDF and ChaCha20-Poly1305 (OpenSSL) as an independent
 * implementation. The Pond's `setup-channel-vectors.json` will pin the same values byte for byte.
 */
import { createCipheriv, hkdfSync } from 'node:crypto';

import {
  channelKeys,
  counterNonce,
  openMessage,
  PHONE_TO_POND_INFO,
  POND_TO_PHONE_INFO,
  SealedDirection,
  sealMessage,
  SealingError,
} from '../setup-channel/sealing';

const isk = Uint8Array.from({ length: 64 }, (_, i) => i);
const sid = Uint8Array.from({ length: 64 }, (_, i) => 255 - i);

describe('setup channel sealing', () => {
  it('draws one key per direction from ISK, salted with sid, as HKDF-SHA-512', () => {
    const keys = channelKeys(isk, sid);
    expect(Buffer.from(keys.pondToPhone)).toEqual(Buffer.from(hkdfSync('sha512', isk, sid, POND_TO_PHONE_INFO, 32)));
    expect(Buffer.from(keys.phoneToPond)).toEqual(Buffer.from(hkdfSync('sha512', isk, sid, PHONE_TO_POND_INFO, 32)));
    expect(Buffer.from(keys.pondToPhone)).not.toEqual(Buffer.from(keys.phoneToPond));
  });

  it('makes the nonce four zero bytes and a big-endian counter', () => {
    expect(Array.from(counterNonce(0))).toEqual(new Array(12).fill(0));
    expect(Array.from(counterNonce(1))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(Array.from(counterNonce(2 ** 32 + 258))).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 2]);
    expect(() => counterNonce(-1)).toThrow(SealingError);
  });

  it('seals as ChaCha20-Poly1305 with no associated data, ciphertext then tag', () => {
    const key = channelKeys(isk, sid).phoneToPond;
    const plain = Buffer.from('{"id":2,"type":"status"}');
    const sealed = new SealedDirection(key.slice()).seal(plain);
    const cipher = createCipheriv('chacha20-poly1305', key, counterNonce(0), { authTagLength: 16 });
    const expected = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    expect(Buffer.from(sealed)).toEqual(expected);
  });

  it('spends one counter per message, in each direction separately', () => {
    const keys = channelKeys(isk, sid);
    const pond = new SealedDirection(keys.pondToPhone.slice());
    const phone = new SealedDirection(keys.pondToPhone.slice());
    const first = sealMessage(pond, { id: 1 });
    const second = sealMessage(pond, { id: 2 });
    expect(first.sealed).not.toBe(second.sealed);
    expect(openMessage(phone, first)).toEqual({ id: 1 });
    expect(openMessage(phone, second)).toEqual({ id: 2 });
    expect(phone.counter).toBe(2);
  });

  it('refuses a message out of order, and a replay', () => {
    const keys = channelKeys(isk, sid);
    const pond = new SealedDirection(keys.pondToPhone.slice());
    const first = sealMessage(pond, { id: 1 });
    const second = sealMessage(pond, { id: 2 });
    expect(() => openMessage(new SealedDirection(keys.pondToPhone.slice()), second)).toThrow(SealingError);
    const phone = new SealedDirection(keys.pondToPhone.slice());
    openMessage(phone, first);
    expect(() => openMessage(phone, first)).toThrow(SealingError);
  });

  it('refuses a tampered message and the other direction’s key', () => {
    const keys = channelKeys(isk, sid);
    const sealed = sealMessage(new SealedDirection(keys.pondToPhone.slice()), { id: 1 });
    const bytes = Buffer.from(sealed.sealed, 'base64');
    bytes[0] ^= 1;
    expect(() => openMessage(new SealedDirection(keys.pondToPhone.slice()), { sealed: bytes.toString('base64') })).toThrow(SealingError);
    expect(() => openMessage(new SealedDirection(keys.phoneToPond.slice()), sealed)).toThrow(SealingError);
  });

  it('refuses a message that is not sealed at all', () => {
    const phone = new SealedDirection(channelKeys(isk, sid).pondToPhone);
    expect(() => openMessage(phone, { id: 1, type: 'status', ok: true })).toThrow(SealingError);
    expect(() => openMessage(phone, { sealed: 'not base64!' })).toThrow(SealingError);
  });
});
