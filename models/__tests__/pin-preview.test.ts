/**
 * A pin learned from the network is confirmed by reading its start against the
 * Pond's own dashboard. What is read has to be long enough that no other key
 * shares it, and grouped so a person can compare it.
 */
import { fingerprintChoices, pinPreview, validPin } from '@/models/connection';

const PIN = 'sha256/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/abcde=';

describe('pinPreview', () => {
  it('uses a real pin', () => {
    expect(validPin(PIN)).toBe(true);
  });

  it('shows the first twelve characters in groups of four', () => {
    expect(pinPreview(PIN)).toBe('sha256/AbCd EfGh IjKl');
  });

  it('is a prefix of the pin once the grouping is removed', () => {
    expect(PIN.startsWith(pinPreview(PIN).replace(/ /g, ''))).toBe(true);
  });
});

describe('fingerprintChoices', () => {
  /** A deterministic stand-in for a cryptographic source. */
  function counter(start = 0) {
    let next = start;
    return (count: number) => Uint8Array.from({ length: count }, () => next++ % 256);
  }

  it('offers the real preview and two distinct decoys', () => {
    const choices = fingerprintChoices(PIN, counter());
    expect(choices).toHaveLength(3);
    expect(new Set(choices).size).toBe(3);
    expect(choices).toContain(pinPreview(PIN));
  });

  it('makes the decoys share the first group, so all twelve characters must be read', () => {
    for (const choice of fingerprintChoices(PIN, counter(7))) {
      expect(choice).toMatch(/^sha256\/AbCd [A-Za-z0-9+/]{4} [A-Za-z0-9+/]{4}$/);
    }
  });

  it('does not always put the real preview in the same place', () => {
    const positions = new Set<number>();
    for (let seed = 0; seed < 64; seed++) {
      positions.add(fingerprintChoices(PIN, counter(seed * 5)).indexOf(pinPreview(PIN)));
    }
    expect(positions).toEqual(new Set([0, 1, 2]));
  });

  it('draws again rather than offer a decoy twice', () => {
    // The second decoy draw repeats the first, so a third draw is needed.
    const draws = [new Uint8Array(8).fill(1), new Uint8Array(8).fill(1), new Uint8Array(8).fill(2)];
    let decoyDraws = 0;
    const source = (count: number) => {
      if (count === 8) return draws[decoyDraws++];
      return new Uint8Array(count);
    };
    const choices = fingerprintChoices(PIN, source);
    expect(decoyDraws).toBe(3);
    expect(new Set(choices).size).toBe(3);
    expect(choices).toEqual(expect.arrayContaining(['sha256/AbCd BBBB BBBB', 'sha256/AbCd CCCC CCCC']));
  });
});
