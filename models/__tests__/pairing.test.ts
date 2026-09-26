/**
 * The QR payload parser, and the handoff that carries its result.
 *
 * Both sit on the pairing path, where a wrong answer is expensive: a malformed
 * payload that parses would send a bad MAC and burn a challenge, and a payload
 * that outlives its read would let a stale code be used on a later visit.
 */

import {
  InvalidPairingCodeError,
  isPairingPayload,
  looksLikeMatterSetupCode,
  looksLikeTypedSetupCode,
  parsePairingPayload,
} from '@/models/pairing';
import {
  offerPairingPayload,
  offerSetupCode,
  takePairingPayload,
  takeSetupCode,
} from '@/services/pairing-handoff';

const VALID = 'pond://pair?v=2&scheme=https&pin=sha256%2FAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%3D&host=pond.local&port=4000&code=123456';

describe('parsePairingPayload', () => {
  it('reads the shape the Pond dashboard emits', () => {
    expect(parsePairingPayload(VALID)).toEqual({
      serverUrl: 'https://pond.local:4000',
      host: 'pond.local',
      code: '123456',
      pin: 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      profile: { version: 2, host: 'pond.local', port: 4000, localUrls: ['https://pond.local:4000'], remoteUrl: undefined },
    });
  });

  it('tolerates surrounding whitespace from the decoder', () => {
    expect(parsePairingPayload(`  ${VALID}\n`).code).toBe('123456');
  });

  /**
   * Android resolves no mDNS, so on that platform the hostname is dead on
   * arrival and the `ip` parameter is the only one that works. Older ponds do
   * not send it, which is why it stays optional rather than required.
   */
  it('carries the LAN address as a fallback when the QR has one', () => {
    const payload = parsePairingPayload(
      'pond://pair?v=2&scheme=https&pin=sha256%2FAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%3D&host=pond.local&port=4000&code=123456&ip=192.168.1.2',
    );

    expect(payload.serverUrl).toBe('https://pond.local:4000');
    expect(payload.fallbackUrl).toBe('https://192.168.1.2:4000');
  });

  it('leaves the fallback undefined when a v2 Pond has no LAN address', () => {
    expect(parsePairingPayload(VALID).fallbackUrl).toBeUndefined();
  });

  it('rejects another scheme, so an arbitrary QR cannot start a handshake', () => {
    expect(() => parsePairingPayload('https://example.com/?code=123456')).toThrow(
      InvalidPairingCodeError,
    );
  });

  it.each([
    ['no host', 'pond://pair?v=2&scheme=https&pin=sha256%2FAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%3D&port=4000&code=123456'],
    ['no port', 'pond://pair?v=2&scheme=https&pin=sha256%2FAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%3D&host=pond.local&code=123456'],
    ['no code', 'pond://pair?v=2&scheme=https&pin=sha256%2FAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%3D&host=pond.local&port=4000'],
    ['not a URL', 'just some text'],
  ])('rejects a payload with %s', (_label, raw) => {
    expect(() => parsePairingPayload(raw)).toThrow(InvalidPairingCodeError);
  });

  /**
   * The typed path enforces six digits. A scanned code takes the same handshake,
   * so it is held to the same rule — otherwise the two entry points disagree and
   * only one of them catches a malformed code before it costs a challenge.
   */
  it.each(['12345', '1234567', 'abcdef'])('rejects the non-six-digit code %s', (code) => {
    expect(() => parsePairingPayload(`pond://pair?v=2&scheme=https&pin=sha256%2FAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%3D&host=p.local&port=4000&code=${code}`)).toThrow(
      InvalidPairingCodeError,
    );
  });
});

describe('pairing handoff', () => {
  it('hands the payload to exactly one reader', () => {
    const payload = parsePairingPayload(VALID);
    offerPairingPayload(payload);

    expect(takePairingPayload()).toEqual(payload);
    // Cleared, so revisiting the wizard cannot replay a code that is now spent.
    expect(takePairingPayload()).toBeNull();
  });

  it('returns null when nothing was scanned', () => {
    expect(takePairingPayload()).toBeNull();
  });
});

describe('the tailnet address', () => {
  // The address that still reaches the Pond once the phone leaves the house.
  it('is parsed from ts= when the Pond is on a tailnet', () => {
    const payload = parsePairingPayload(`${VALID}&ip=192.168.1.11&ts=100.101.102.103`);

    expect(payload.remoteUrl).toBe('https://100.101.102.103:4000');
    expect(payload.fallbackUrl).toBe('https://192.168.1.11:4000');
  });

  it('is absent for a Pond that is not on a tailnet', () => {
    // An older server, or one nobody has joined to a tailnet. The QR is still
    // valid and pairing at home still works.
    expect(parsePairingPayload(`${VALID}&ip=192.168.1.11`).remoteUrl).toBeUndefined();
  });

  it('carries the same port as the rest of the payload', () => {
    const payload = parsePairingPayload(
      'pond://pair?v=2&scheme=https&pin=sha256%2FAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%3D&host=nano.local&port=8080&code=123456&ts=100.64.0.7',
    );

    expect(payload.remoteUrl).toBe('https://100.64.0.7:8080');
  });
});

describe('looksLikeMatterSetupCode', () => {
  // Two QR codes are in play and the wrong one is a reasonable thing to scan:
  // the Pond's dashboard shows a pairing code, every Matter device ships with a
  // commissioning code. This is what lets the scanner say which is which.
  it('recognises the MT: QR payload a Matter device carries', () => {
    expect(looksLikeMatterSetupCode('MT:Y.K9042C00KA0648G00')).toBe(true);
  });

  it('recognises the 11- and 21-digit manual codes printed beside it', () => {
    expect(looksLikeMatterSetupCode('34970112332')).toBe(true);
    expect(looksLikeMatterSetupCode('3497-011-2332')).toBe(true);
    expect(looksLikeMatterSetupCode('123456789012345678901')).toBe(true);
  });

  it('does not claim a pairing URL', () => {
    expect(looksLikeMatterSetupCode(VALID)).toBe(false);
  });

  it('does not claim a bare six-digit pairing code', () => {
    // The wizard's own code is six digits; mistaking it for a Matter code would
    // send the user to the wrong screen with the right code in their hand.
    expect(looksLikeMatterSetupCode('123456')).toBe(false);
  });

  it('does not claim an empty or bare MT: prefix', () => {
    expect(looksLikeMatterSetupCode('')).toBe(false);
    expect(looksLikeMatterSetupCode('MT:')).toBe(false);
  });
});

describe('looksLikeTypedSetupCode', () => {
  // The controller accepts a bare 8-digit passcode, so the field must too, or
  // the Add Device button stays dead against a code the Pond would have taken.
  it('accepts the bare passcode a typed code may be', () => {
    expect(looksLikeTypedSetupCode('20202021')).toBe(true);
    expect(looksLikeTypedSetupCode('2020-2021')).toBe(true);
  });

  // And the scanner must NOT, which is why these are two functions. A passcode
  // is printed beside the QR, never inside one, so treating eight digits as
  // scannable would make any short number on a label read as a device.
  it('is the one place the passcode is accepted', () => {
    expect(looksLikeMatterSetupCode('20202021')).toBe(false);
  });

  it('still accepts everything the scanner does', () => {
    for (const code of ['MT:Y.K9042C00KA0648G00', '34970112332', '123456789012345678901']) {
      expect(looksLikeTypedSetupCode(code)).toBe(true);
    }
  });

  it('refuses the wizard\u2019s own six-digit code and empty input', () => {
    expect(looksLikeTypedSetupCode('123456')).toBe(false);
    expect(looksLikeTypedSetupCode('')).toBe(false);
    expect(looksLikeTypedSetupCode('   ')).toBe(false);
  });
});

describe('isPairingPayload', () => {
  it('answers yes for a payload and no for anything else, without throwing', () => {
    expect(isPairingPayload(VALID)).toBe(true);
    expect(isPairingPayload('MT:Y.K9042C00KA0648G00')).toBe(false);
    expect(isPairingPayload('not a url at all')).toBe(false);
    expect(isPairingPayload('')).toBe(false);
  });
});

describe('the setup-code handoff', () => {
  it('hands a scanned code over exactly once', () => {
    offerSetupCode('MT:Y.K9042C00KA0648G00');
    expect(takeSetupCode()).toBe('MT:Y.K9042C00KA0648G00');
    // Cleared by the read: returning to the commissioning screen later must not
    // resurrect a code the user has already used or abandoned.
    expect(takeSetupCode()).toBeNull();
  });

  // Separate slots, so whichever screen looks first cannot take the other's
  // scan. Sharing one would make the mix-up a runtime accident.
  it('does not cross with the pairing payload', () => {
    offerSetupCode('MT:Y.K9042C00KA0648G00');
    expect(takePairingPayload()).toBeNull();
    expect(takeSetupCode()).toBe('MT:Y.K9042C00KA0648G00');

    offerPairingPayload(parsePairingPayload(VALID));
    expect(takeSetupCode()).toBeNull();
    expect(takePairingPayload()).not.toBeNull();
  });
});
