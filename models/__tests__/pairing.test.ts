/**
 * The QR payload parser, and the handoff that carries its result.
 *
 * Both sit on the pairing path, where a wrong answer is expensive: a malformed
 * payload that parses would send a bad MAC and burn a challenge, and a payload
 * that outlives its read would let a stale code be used on a later visit.
 */

import { InvalidPairingCodeError, parsePairingPayload } from '@/models/pairing';
import { offerPairingPayload, takePairingPayload } from '@/services/pairing-handoff';

const VALID = 'pond://pair?host=pond.local&port=4000&code=123456';

describe('parsePairingPayload', () => {
  it('reads the shape the Pond dashboard emits', () => {
    expect(parsePairingPayload(VALID)).toEqual({
      serverUrl: 'http://pond.local:4000',
      host: 'pond.local',
      code: '123456',
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
      'pond://pair?host=pond.local&port=4000&code=123456&ip=192.168.1.2',
    );

    expect(payload.serverUrl).toBe('http://pond.local:4000');
    expect(payload.fallbackUrl).toBe('http://192.168.1.2:4000');
  });

  it('leaves the fallback undefined when an older pond sends no ip', () => {
    expect(parsePairingPayload(VALID).fallbackUrl).toBeUndefined();
  });

  it('rejects another scheme, so an arbitrary QR cannot start a handshake', () => {
    expect(() => parsePairingPayload('https://example.com/?code=123456')).toThrow(
      InvalidPairingCodeError,
    );
  });

  it.each([
    ['no host', 'pond://pair?port=4000&code=123456'],
    ['no port', 'pond://pair?host=pond.local&code=123456'],
    ['no code', 'pond://pair?host=pond.local&port=4000'],
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
    expect(() => parsePairingPayload(`pond://pair?host=p.local&port=4000&code=${code}`)).toThrow(
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
