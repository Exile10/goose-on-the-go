/**
 * What the pairing wizard says for each refusal a setup card or a spoken code can meet, and
 * that the pairing code's own sentences are unchanged by them.
 */
import i18n from '@/services/i18n';
import { ApiError, PondOutdatedError } from '@/services/api-client';
import { PondTrustError } from '@/services/pond-trust';
import {
  describePairingFailure,
  describeSpokenCodeFailure,
  explainRefusedPairing,
  explainRejection,
  isClaimedRefusal,
  refusalWait,
} from '@/view-models/pairing-errors';

const t = i18n.t;
const refusal = (status: number, detail: string | null, wait: number | null = null) =>
  new ApiError(`handshake → ${status}`, status, wait, detail);

describe('a setup card that is refused', () => {
  it('tells someone holding the card of a claimed Pond to ask its owner or have it say a code', () => {
    const said = describePairingFailure(refusal(409, 'setup_code_unavailable'), t, 'setup');
    expect(said).toBe(t('pairingErrors.setupClaimed'));
    expect(said).toMatch(/already been set up/);
    expect(said).toMatch(/say a pairing code/);
    expect(isClaimedRefusal(refusal(409, 'setup_code_unavailable'))).toBe(true);
  });

  it('says another phone won the race when verify is what refused', () => {
    expect(explainRefusedPairing('setup_code_unavailable', t, 'setup')).toBe(t('pairingErrors.setupClaimedFirst'));
  });

  it('carries the cooling wait, and says something useful without one', () => {
    const cooling = refusal(429, 'setup_code_cooling', 30);
    expect(refusalWait(cooling, 'setup_code_cooling')).toBe(30);
    expect(refusalWait(refusal(429, 'setup_code_cooling'), 'setup_code_cooling')).toBeNull();
    expect(refusalWait(refusal(429, 'pairing_busy', 30), 'setup_code_cooling')).toBeNull();
    expect(describePairingFailure(cooling, t, 'setup')).toBe(t('pairingErrors.setupCoolingNoHint'));
    expect(t('pairingErrors.setupCooling', { count: 1 })).toMatch(/in 1 second\./);
    expect(t('pairingErrors.setupCooling', { count: 42 })).toMatch(/in 42 seconds\./);
  });

  // A setup code is only ever slowed, so the pairing code's "retired after 10" would mislead.
  it('names a wrong setup code without the pairing code\'s retirement warning', () => {
    expect(explainRejection('invalid_confirmation', t, 'setup')).toBe(t('pairingErrors.setupBadCode'));
    expect(explainRejection('invalid_confirmation', t, 'setup')).not.toMatch(/10 wrong/);
    expect(explainRefusedPairing('invalid_confirmation', t, 'setup')).toBe(t('pairingErrors.setupBadCode'));
  });

  it('reads a Pond that does not know the credential as one that needs updating', () => {
    expect(describePairingFailure(refusal(400, 'invalid_credential'), t, 'setup')).toBe(t('pairingErrors.pondOutdated'));
  });
});

describe('the refusals pairing already had', () => {
  it('keep their sentences', () => {
    expect(explainRefusedPairing('invalid_confirmation', t)).toBe(t('pairingErrors.badCode'));
    expect(explainRefusedPairing('code_retired', t)).toBe(t('pairingErrors.codeRetired'));
    expect(explainRefusedPairing('something_new', t)).toBe(t('pairingErrors.rejected'));
    expect(describePairingFailure(refusal(403, 'channel_binding_mismatch'), t)).toBe(t('connection.trust'));
    expect(describePairingFailure(refusal(403, 'pairing_requires_lan'), t)).toBe(t('pairing.lan'));
    expect(describePairingFailure(new PondOutdatedError(2), t)).toBe(t('pairingErrors.pondOutdated'));
    expect(describePairingFailure(new PondTrustError(), t)).toBe(t('connection.trust'));
    expect(describePairingFailure(new Error('Network request failed'), t)).toBe(t('pairingErrors.unreachable'));
  });

  it('do not read a pairing refusal as a claimed Pond', () => {
    expect(isClaimedRefusal(refusal(403, 'channel_binding_mismatch'))).toBe(false);
    expect(isClaimedRefusal(new Error('setup_code_unavailable'))).toBe(false);
  });
});

describe('a spoken code that is refused', () => {
  it('counts down the Pond\'s limit, and says what to do without a wait', () => {
    const limited = refusal(429, 'spoken_code_limited', 30);
    expect(refusalWait(limited, 'spoken_code_limited')).toBe(30);
    expect(describeSpokenCodeFailure(limited, t, 30)).toMatch(/in 30 seconds\./);
    expect(describeSpokenCodeFailure(limited, t, 1)).toMatch(/in 1 second\./);
    expect(describeSpokenCodeFailure(limited, t, 0)).toBe(t('pairingErrors.spokenLimitedNoHint'));
  });

  it.each([
    [403, 'spoken_codes_disabled', 'pairingErrors.spokenDisabled'],
    [503, 'announcer_unavailable', 'pairingErrors.spokenSilent'],
    [403, 'pairing_requires_lan', 'pairing.lan'],
    [404, null, 'pairingErrors.pondOutdated'],
  ] as const)('says %s %s as %s', (status, detail, key) => {
    expect(describeSpokenCodeFailure(refusal(status, detail), t, 0)).toBe(t(key));
  });

  it('falls back to the transport sentences for anything else', () => {
    expect(describeSpokenCodeFailure(refusal(500, null), t, 0)).toBe(t('pairingErrors.serverError'));
    expect(describeSpokenCodeFailure(new Error('Network request failed'), t, 0)).toBe(t('pairingErrors.unreachable'));
  });

  it('never shows the Pond\'s own identifier or a status code', () => {
    for (const detail of ['spoken_code_limited', 'spoken_codes_disabled', 'announcer_unavailable']) {
      const said = describeSpokenCodeFailure(refusal(429, detail, 5), t, 5);
      expect(said).not.toContain(detail);
      expect(said).not.toMatch(/\b\d{3}\b/);
    }
  });
});

describe('a device resume that is refused', () => {
  it('names a session that rotated between init and verify, and carries the device cooling wait', () => {
    expect(explainRejection('invalid_or_expired_refresh', t)).toBe(t('pairingErrors.resumeRotated'));
    const cooling = new ApiError('pake_init refused: device_cooling', 429, 45, 'device_cooling');
    expect(refusalWait(cooling, 'device_cooling')).toBe(45);
    expect(refusalWait(cooling, 'setup_code_cooling')).toBeNull();
  });
});
