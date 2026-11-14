/**
 * A phone waiting for a locked Pond's main member to let it in: it asks until it is answered,
 * and the main member's own new phone can let itself in with the Pond's recovery PIN instead.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCountdown } from '@/hooks/use-countdown';
import { isRecoveryPin, pinDigits, type HeldPairing } from '@/models/pairing-lock';
import type { PairingClaim, PairingRecovery } from '@/services/api-client';
import { waitForPairing } from '@/services/pairing-request';
import { describePairingFailure } from './pairing-errors';

export type WaitPhase =
  | 'waiting'
  | 'declined'
  /** The request ran out, or the Pond let it go. */
  | 'gone'
  /** The Pond would not answer about the request at all. */
  | 'refused';

export interface UsePairingWait {
  data: {
    phase: WaitPhase;
    /** What to say for `refused`. */
    refusal: string | null;
    recovery: {
      /** The PIN field is showing. */
      open: boolean;
      pin: string;
      /** The PIN is long enough to send, nothing is in flight, and the Pond is not making this phone wait. */
      ready: boolean;
      checking: boolean;
      error: string | null;
      /** Seconds before the Pond takes another PIN. */
      coolingSecs: number;
    };
  };
  actions: {
    openRecovery: () => void;
    closeRecovery: () => void;
    setPin: (typed: string) => void;
    submitPin: () => void;
  };
}

export interface PairingWaitDeps {
  claim: (held: HeldPairing) => Promise<PairingClaim>;
  recover: (held: HeldPairing, pin: string) => Promise<PairingRecovery>;
  /** The pairing is kept; the caller goes on as after any accepted pairing. */
  onPaired: () => void;
}

export function usePairingWait(held: HeldPairing | null, deps: PairingWaitDeps): UsePairingWait {
  const { t } = useTranslation();
  // How the wait on a request ended. Kept with its request, so a new request starts as waiting.
  const [ended, setEnded] = useState<{ held: HeldPairing; phase: Exclude<WaitPhase, 'waiting'>; refusal: string | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [pin, setPinState] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { left: coolingSecs, start: startCooling, stop: stopCooling } = useCountdown();
  // The latest callbacks, so a re-render never restarts the wait and sends a request early.
  const latest = useRef(deps);
  useEffect(() => {
    latest.current = deps;
  });
  // The poll and the PIN can both be answered; the first answer is the one acted on.
  const settledFor = useRef<HeldPairing | null>(null);

  const settle = useCallback(
    (asked: HeldPairing, outcome: PairingClaim | { status: 'refused'; error: unknown } | { status: 'stopped' }) => {
      if (settledFor.current === asked || outcome.status === 'waiting' || outcome.status === 'stopped') return;
      settledFor.current = asked;
      if (outcome.status === 'paired') {
        latest.current.onPaired();
        return;
      }
      setEnded({
        held: asked,
        phase: outcome.status,
        refusal: outcome.status === 'refused' ? describePairingFailure(outcome.error, t) : null,
      });
    },
    [t],
  );

  useEffect(() => {
    if (!held) return;
    const stop = new AbortController();
    void waitForPairing(held, { claim: (h) => latest.current.claim(h) }, stop.signal).then((outcome) => settle(held, outcome));
    return () => stop.abort();
  }, [held, settle]);

  const over = held !== null && ended?.held === held;
  const phase: WaitPhase = over ? ended.phase : 'waiting';
  const refusal = over ? ended.refusal : null;

  const submitPin = useCallback(async () => {
    if (!held || checking || coolingSecs > 0 || !isRecoveryPin(pin) || settledFor.current === held) return;
    setChecking(true);
    setError(null);
    try {
      const answer = await latest.current.recover(held, pin);
      switch (answer.status) {
        case 'wrong_pin':
          setPinState('');
          setError(answer.triesLeft === null ? t('pairingLock.wait.wrongPin') : t('pairingLock.wait.wrongPinLeft', { count: answer.triesLeft }));
          break;
        case 'cooling':
          setPinState('');
          startCooling(answer.retryAfterSecs);
          break;
        case 'no_pin':
          setError(t('pairingLock.wait.noPin'));
          break;
        default:
          settle(held, answer);
      }
    } catch (e) {
      setError(describePairingFailure(e, t));
    } finally {
      setChecking(false);
    }
  }, [held, checking, coolingSecs, pin, settle, startCooling, t]);

  const openRecovery = useCallback(() => setOpen(true), []);
  const closeRecovery = useCallback(() => {
    setOpen(false);
    setPinState('');
    setError(null);
    stopCooling();
  }, [stopCooling]);
  const setPin = useCallback((typed: string) => {
    setPinState(pinDigits(typed));
    setError(null);
  }, []);

  return {
    data: {
      phase,
      refusal,
      recovery: { open, pin, ready: isRecoveryPin(pin) && !checking && coolingSecs === 0, checking, error, coolingSecs },
    },
    actions: { openRecovery, closeRecovery, setPin, submitPin: () => void submitPin() },
  };
}
