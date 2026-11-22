// The pairing lock as the phone reads it: a held request, the lock a paired member sees, and the
// phones waiting. A field of the wrong shape reads as missing.

import {
  heldUntil,
  isRecoveryPin,
  lockGap,
  pinDigits,
  readHeldPairing,
  readPairingLock,
  readPairingRequests,
} from '@/models/pairing-lock';

describe('readHeldPairing', () => {
  it('needs the request and its secret', () => {
    expect(readHeldPairing({ request_id: 'r1', claim_secret: 'abc', expires_at: '2026-11-13T10:10:00Z' })).toEqual({
      requestId: 'r1',
      claimSecret: 'abc',
      expiresAt: '2026-11-13T10:10:00Z',
    });
    expect(readHeldPairing({ request_id: 'r1' })).toBeNull();
    expect(readHeldPairing({ claim_secret: 'abc' })).toBeNull();
    expect(readHeldPairing(null)).toBeNull();
  });

  it('runs out when the Pond says, or after ten minutes when it does not say', () => {
    const now = Date.parse('2026-11-13T10:00:00Z');
    expect(heldUntil({ requestId: 'r', claimSecret: 's', expiresAt: '2026-11-13T10:07:00Z' }, now)).toBe(now + 7 * 60_000);
    expect(heldUntil({ requestId: 'r', claimSecret: 's', expiresAt: 'soon' }, now)).toBe(now + 10 * 60_000);
  });
});

describe('readPairingLock', () => {
  const wire = {
    locked: true,
    enforced: false,
    owner_profile_id: 'p1',
    has_recovery_pin: false,
    owner_has_a_phone: false,
    min_pin_digits: 6,
    can_change: true,
  };

  it('reads the lock as the Pond answers it', () => {
    expect(readPairingLock(wire)).toEqual({
      locked: true,
      enforced: false,
      ownerProfileId: 'p1',
      hasRecoveryPin: false,
      ownerHasAPhone: false,
      minPinDigits: 6,
      canChange: true,
    });
  });

  it('is nothing without knowing whether pairing is locked, and grants nothing it was not told', () => {
    expect(readPairingLock({})).toBeNull();
    expect(readPairingLock({ locked: false })).toMatchObject({ canChange: false, enforced: false, minPinDigits: 6 });
  });

  it('says why a lock that is on is not holding', () => {
    expect(lockGap(readPairingLock(wire)!)).toBe('no_phone_or_pin');
    expect(lockGap(readPairingLock({ ...wire, owner_profile_id: null })!)).toBe('no_main_member');
    expect(lockGap(readPairingLock({ ...wire, enforced: true, owner_has_a_phone: true })!)).toBeNull();
    expect(lockGap(readPairingLock({ ...wire, locked: false })!)).toBeNull();
  });
});

describe('a recovery PIN', () => {
  it('is six to twelve digits and nothing else', () => {
    expect(isRecoveryPin('123456')).toBe(true);
    expect(isRecoveryPin('123456789012')).toBe(true);
    expect(isRecoveryPin('12345')).toBe(false);
    expect(isRecoveryPin('1234567890123')).toBe(false);
    expect(isRecoveryPin('12345a')).toBe(false);
    expect(isRecoveryPin('')).toBe(false);
  });

  it('keeps what is typed to digits, twelve at most', () => {
    expect(pinDigits('12 34-56')).toBe('123456');
    expect(pinDigits('1234567890123456')).toBe('123456789012');
  });
});

describe('readPairingRequests', () => {
  it('lists the phones waiting, and skips one with no id', () => {
    const requests = readPairingRequests({
      requests: [
        { id: 'r1', client_id: 'c', client_type: 'gotg', device_name: 'Wanjiru’s phone', profile_id: null, created_at: '2026-11-13T10:00:00Z', expires_at: '2026-11-13T10:10:00Z' },
        { device_name: 'No id' },
      ],
    });
    expect(requests).toEqual([
      { id: 'r1', deviceName: 'Wanjiru’s phone', clientType: 'gotg', profileId: null, createdAt: '2026-11-13T10:00:00Z', expiresAt: '2026-11-13T10:10:00Z' },
    ]);
    expect(readPairingRequests({})).toEqual([]);
  });
});
