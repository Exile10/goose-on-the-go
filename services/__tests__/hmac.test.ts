/**
 * RFC 4231 test vectors for HMAC-SHA256.
 *
 * services/hmac.ts is a hand-written SHA-256 and HMAC, carried because Web
 * Crypto is not reliably present across React Native versions. It has no
 * runtime that would complain if it were subtly wrong: a bad MAC is simply
 * rejected by the server, so every user would fail to pair with no clue why.
 * Standard vectors are the only cheap way to know it is correct.
 *
 * Cases 1-4 and 6-7 from RFC 4231 section 4. Case 5 is a truncation test and
 * does not apply — this module returns the full digest.
 */

import { concat, fromBase64, hmacSha256, toHex, utf8 } from '@/services/hmac';

/** Bytes from a hex string, for the vectors that specify keys that way. */
function hex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

describe('hmacSha256 — RFC 4231 vectors', () => {
  it('case 1: 20-byte key', async () => {
    const mac = await hmacSha256(hex('0b'.repeat(20)), utf8('Hi There'));
    expect(toHex(mac)).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  });

  it('case 2: key shorter than the block size', async () => {
    const mac = await hmacSha256(utf8('Jefe'), utf8('what do ya want for nothing?'));
    expect(toHex(mac)).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  it('case 3: 20-byte key, 50 bytes of 0xdd', async () => {
    const mac = await hmacSha256(hex('aa'.repeat(20)), hex('dd'.repeat(50)));
    expect(toHex(mac)).toBe('773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe');
  });

  it('case 4: 25-byte key, 50 bytes of 0xcd', async () => {
    const key = hex('0102030405060708090a0b0c0d0e0f10111213141516171819');
    const mac = await hmacSha256(key, hex('cd'.repeat(50)));
    expect(toHex(mac)).toBe('82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b');
  });

  /**
   * The case that catches the classic mistake. A key longer than the 64-byte
   * block must be hashed down first; an implementation that skips that step
   * passes every shorter vector above and fails only here.
   */
  it('case 6: key longer than the block size', async () => {
    const mac = await hmacSha256(
      hex('aa'.repeat(131)),
      utf8('Test Using Larger Than Block-Size Key - Hash Key First'),
    );
    expect(toHex(mac)).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });

  it('case 7: key and message both longer than the block size', async () => {
    const mac = await hmacSha256(
      hex('aa'.repeat(131)),
      utf8(
        'This is a test using a larger than block-size key and a larger than block-size data. ' +
          'The key needs to be hashed before being used by the HMAC algorithm.',
      ),
    );
    expect(toHex(mac)).toBe('9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2');
  });
});

describe('helpers', () => {
  it('decodes base64 to the bytes the server sent', () => {
    // The challenge arrives base64-encoded and is fed to the MAC as raw bytes.
    expect(Array.from(fromBase64('AAECA/8='))).toEqual([0, 1, 2, 3, 255]);
  });

  it('concatenates in order, which is what the MAC input depends on', () => {
    // The signed message is challenge || client_id; swapping the two operands
    // still produces a valid-looking hex MAC that the server would reject.
    const joined = concat(new Uint8Array([1, 2]), new Uint8Array([3, 4, 5]));
    expect(Array.from(joined)).toEqual([1, 2, 3, 4, 5]);
  });

  it('hex-encodes with a leading zero preserved', () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
  });
});
