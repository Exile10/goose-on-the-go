/**
 * The draft half of `services/cpace.ts`, against draft-irtf-cfrg-cpace-21's own
 * vectors: A.1 (`prepend_len`, `lv_cat`) and B.3 (ristretto255 with SHA-512).
 *
 * The vector file is a byte-identical copy of the Pond's
 * `crates/pond-infra/tests/fixtures/cpace-ristr255-sha512-draft21.json`, so the
 * two implementations are held to one transcription of the draft.
 */
import { ristretto255, ristretto255_hasher } from '@noble/curves/ed25519.js';
import { bytesToNumberLE, hexToBytes } from '@noble/curves/utils.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
  calculateGenerator,
  DSI,
  generatorString,
  intermediateSessionKey,
  lvCat,
  prependLen,
  sampleScalar,
  scalarMult,
  scalarMultVfy,
} from '../cpace';
import vectors from './vectors/cpace-ristr255-sha512-draft21.json';

const hex = (bytes: Uint8Array) => bytesToHex(bytes);
const bytes = (h: string) => hexToBytes(h);
const range = (n: number) => Uint8Array.from({ length: n }, (_, i) => i);
const ascii = (s: string) => new TextEncoder().encode(s);

describe('A.1 string utilities', () => {
  it('prepend_len', () => {
    const p = vectors.prepend_len;
    expect(hex(prependLen(new Uint8Array(0)))).toBe(p.empty);
    expect(hex(prependLen(ascii('1234')))).toBe(p['1234']);
    expect(hex(prependLen(range(127)))).toBe(p.range_127);
    // 128 is the first length that needs a second LEB128 byte.
    expect(hex(prependLen(range(128)))).toBe(p.range_128);
  });

  it('lv_cat', () => {
    expect(hex(lvCat(ascii('1234'), ascii('5'), new Uint8Array(0), ascii('678'))))
      .toBe(vectors.lv_cat['1234_5_empty_678']);
  });
});

describe('B.3 CPACE-RISTR255-SHA512', () => {
  const { inputs, generator, outputs } = vectors;

  it('B.3.1 generator string, its hash, and the generator', () => {
    expect(hex(DSI)).toBe(inputs.DSI);
    const str = generatorString(DSI, bytes(inputs.PRS), bytes(inputs.CI), bytes(inputs.sid), 128);
    // 128 - 1 - len(prepend_len(PRS)) - len(prepend_len(DSI)).
    expect(128 - 1 - prependLen(bytes(inputs.PRS)).length - prependLen(DSI).length).toBe(generator.zpad_length);
    expect(hex(str)).toBe(generator.generator_string);
    expect(hex(sha512(str))).toBe(generator.hash);
    expect(hex(calculateGenerator(bytes(inputs.PRS), bytes(inputs.CI), bytes(inputs.sid)).toBytes())).toBe(generator.g);
  });

  // The trap the module's doc names: noble's similarly named RFC 9380 map is a different function.
  it('B.3.1 is not reproduced by hashToCurve', () => {
    const str = generatorString(DSI, bytes(inputs.PRS), bytes(inputs.CI), bytes(inputs.sid), 128);
    expect(hex(ristretto255_hasher.hashToCurve(sha512(str)).toBytes())).not.toBe(generator.g);
  });

  it('B.3.2-B.3.5 shares, K, the transcript and the initiator-responder ISK', () => {
    const g = calculateGenerator(bytes(inputs.PRS), bytes(inputs.CI), bytes(inputs.sid));
    const ya = bytesToNumberLE(bytes(inputs.ya));
    const yb = bytesToNumberLE(bytes(inputs.yb));
    expect(hex(scalarMult(ya, g))).toBe(outputs.Ya);
    expect(hex(scalarMult(yb, g))).toBe(outputs.Yb);
    expect(hex(scalarMultVfy(ya, bytes(outputs.Yb)))).toBe(outputs.K);
    expect(hex(scalarMultVfy(yb, bytes(outputs.Ya)))).toBe(outputs.K);
    expect(hex(lvCat(bytes(outputs.Ya), bytes(inputs.ADa)))
      + hex(lvCat(bytes(outputs.Yb), bytes(inputs.ADb)))).toBe(outputs.transcript_ir);
    expect(hex(intermediateSessionKey(bytes(inputs.sid), bytes(outputs.K),
      bytes(outputs.Ya), bytes(inputs.ADa), bytes(outputs.Yb), bytes(inputs.ADb)))).toBe(outputs.ISK_ir);
  });

  it('B.3.10-B.3.11 scalar_mult_vfy: a valid point, then the two that must give the identity', () => {
    const { scalar_mult: valid, invalid_points: invalid } = vectors;
    const s = bytesToNumberLE(bytes(valid.s));
    expect(hex(scalarMultVfy(s, bytes(valid.X)))).toBe(valid.result);
    const identity = '00'.repeat(32);
    // Y_i1 is a non-canonical encoding; Y_i2 is the identity itself.
    expect(hex(scalarMultVfy(s, bytes(invalid.Y_i1)))).toBe(identity);
    expect(hex(scalarMultVfy(s, bytes(invalid.Y_i2)))).toBe(identity);
  });
});

describe('sample_scalar', () => {
  it('clears bits 252-255 and reads little-endian', () => {
    const scalar = sampleScalar((n) => new Uint8Array(n).fill(0xff));
    expect(scalar).toBe((1n << 252n) - 1n);
    expect(scalar < ristretto255.Point.Fn.ORDER).toBe(true);
  });

  it('redraws zero, which would send the identity', () => {
    const draws = [new Uint8Array(32), Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? 7 : 0))];
    const random = jest.fn(() => draws.shift()!);
    expect(sampleScalar(random)).toBe(7n);
    expect(random).toHaveBeenCalledTimes(2);
  });

  it('wipes the bytes it read', () => {
    const drawn = new Uint8Array(32).fill(0x42);
    sampleScalar(() => drawn);
    expect(drawn.every((b) => b === 0)).toBe(true);
  });
});
