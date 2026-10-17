/** What the pairing wizard says when pairing, claiming or asking for a spoken code fails. */

import type { TFunction } from 'i18next';

import { ApiError, PondOutdatedError } from '@/services/api-client';
import type { PakeCredential } from '@/services/cpace';
import { PondTrustError } from '@/services/pond-trust';
import { describeApiError } from './describe-error';

/**
 * Describe a failure that never reached the verifier — a transport or HTTP
 * error rather than a rejected code.
 *
 * The 429 case is the one that matters. GIAP gives pairing its own rate-limit
 * budget (30/60s, with /handshake/verify further limited to 10/60s), and it
 * sends Retry-After when it throttles. Showing "handshake/init failed: 429",
 * which is what this screen used to print, tells a user nothing and invites
 * them to hammer the button — which is how a phone spends the budget it needs
 * to recover. Naming the wait turns a dead end into an instruction.
 *
 * It takes `t` rather than reaching for a module-level translator: a constant
 * is evaluated at import, before i18next has a language.
 */
export function describeTransportFailure(e: unknown, t: TFunction): string {
  if (e instanceof ApiError) {
    if (e.status === 429) {
      const wait = e.retryAfterSecs;
      return wait
        ? t('pairingErrors.rateLimited', { count: wait, plural: wait === 1 ? '' : 's' })
        : t('pairingErrors.rateLimitedNoHint');
    }
    if (e.status >= 500) {
      return t('pairingErrors.serverError');
    }
    // The wizard runs before there is a session to revoke, so a refusal here
    // is about this attempt and the screen has to say so itself.
    return describeApiError(e) ?? t('pairingErrors.refused');
  }
  return t('pairingErrors.unreachable');
}

/**
 * Turn the server's rejection code into something a person can act on.
 *
 * `rejection_reason` is a closed set from pond-core's handshake verifier, and it
 * was rendered raw -- someone who mistyped a digit was shown the identifier. The
 * cases are split because they call for different things: a stale challenge only
 * needs the same code re-sent, while an expired or retired code needs a new one
 * fetched from the Pond.
 *
 * The 60-second challenge lifetime is worth naming rather than folding into a
 * generic retry message. It is far shorter than the code's ten minutes, so it is
 * the limit a user actually hits. `code_retired` is the Pond's per-code budget:
 * after 10 failed confirmations it stops accepting that code at all, because
 * online guessing is the only attack left on it.
 *
 * The Pond names a refusal of `pake/init` the same way, as an error code rather
 * than a rejection, so this reads both. Null for an identifier this screen has no
 * sentence for.
 */
export function explainRejection(
  reason: string | null,
  t: TFunction,
  credential: PakeCredential = 'pairing',
): string | null {
  switch (reason) {
    case 'invalid_confirmation':
      // A setup code is never retired, only slowed, so the pairing code's warning would be wrong.
      return credential === 'setup' ? t('pairingErrors.setupBadCode') : t('pairingErrors.badCode');
    case 'code_retired':
      return t('pairingErrors.codeRetired');
    case 'challenge_expired':
    case 'challenge_used':
    case 'unknown_challenge':
      return t('pairingErrors.expired');
    case 'no_active_pairing_code':
      return t('pairingErrors.noCode');
    // The pin this phone holds is not the Pond's own.
    case 'channel_binding_mismatch':
      return t('connection.trust');
    // Too many runs waiting on their second half; the Pond asks for a short wait.
    case 'pairing_busy':
      return t('pairingErrors.rateLimitedNoHint');
    case 'setup_code_unavailable':
      return t('pairingErrors.setupClaimed');
    case 'setup_code_cooling':
      return t('pairingErrors.setupCoolingNoHint');
    // A device resume: the session rotated (an HTTPS refresh) between init and verify.
    case 'invalid_or_expired_refresh':
      return t('pairingErrors.resumeRotated');
    // The phone only ever names pairing or setup, so a Pond refusing either does not know this exchange.
    case 'invalid_credential':
      return t('pairingErrors.pondOutdated');
    default:
      return null;
  }
}

/** A verify that came back refused. Only here can "already set up" mean another phone won the race. */
export function explainRefusedPairing(reason: string | null, t: TFunction, credential: PakeCredential = 'pairing'): string {
  if (reason === 'setup_code_unavailable') return t('pairingErrors.setupClaimedFirst');
  return explainRejection(reason, t, credential) ?? t('pairingErrors.rejected');
}

/**
 * Describe a pairing that threw rather than came back refused.
 *
 * Checked in order of how specific the answer is: a Pond too old to speak CPace,
 * a Pond whose answers did not verify, a refusal the Pond named, and only then
 * the transport.
 */
export function describePairingFailure(e: unknown, t: TFunction, credential: PakeCredential = 'pairing'): string {
  if (e instanceof PondOutdatedError) return t('pairingErrors.pondOutdated');
  if (e instanceof PondTrustError) return t('connection.trust');
  if (e instanceof ApiError) {
    const named = explainRejection(e.detail, t, credential);
    if (named) return named;
    // Any other 403 is the Pond refusing enrolment from off its own network.
    if (e.status === 403) return t('pairing.lan');
  }
  return describeTransportFailure(e, t);
}

/** Whether the Pond refused because it has been claimed, so the way on is a pairing code. */
export function isClaimedRefusal(e: unknown): boolean {
  return e instanceof ApiError && e.detail === 'setup_code_unavailable';
}

/** The seconds a refusal named by `code` asked the phone to wait, when it named any. */
export function refusalWait(e: unknown, code: 'setup_code_cooling' | 'spoken_code_limited' | 'device_cooling'): number | null {
  if (!(e instanceof ApiError) || e.detail !== code) return null;
  return e.retryAfterSecs && e.retryAfterSecs > 0 ? e.retryAfterSecs : null;
}

/** Describe a spoken-code request that failed, `waitSecs` being what is left of the wait it was given. */
export function describeSpokenCodeFailure(e: unknown, t: TFunction, waitSecs: number): string {
  if (e instanceof ApiError) {
    switch (e.detail) {
      case 'spoken_code_limited':
        return waitSecs > 0 ? t('pairingErrors.spokenLimited', { count: waitSecs }) : t('pairingErrors.spokenLimitedNoHint');
      case 'spoken_codes_disabled':
        return t('pairingErrors.spokenDisabled');
      case 'announcer_unavailable':
        return t('pairingErrors.spokenSilent');
    }
    if (e.status === 403) return t('pairing.lan');
    // A Pond older than the route has nothing to say a code with.
    if (e.status === 404) return t('pairingErrors.pondOutdated');
  }
  return describeTransportFailure(e, t);
}
