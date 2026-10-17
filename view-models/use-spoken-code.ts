/** Asking the staged Pond to read a pairing code aloud, for the pairing wizard's code step. */

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCountdown } from '@/hooks/use-countdown';
import { useServer } from '@/providers/server-provider';
import { describeSpokenCodeFailure, refusalWait } from './pairing-errors';

export type SpokenCodePhase = 'idle' | 'asking' | 'spoken';

export interface UseSpokenCode {
  data: {
    phase: SpokenCodePhase;
    /** Seconds until the Pond will say another code, when it named a wait. */
    waitSecs: number;
  };
  loading: boolean;
  error: string | null;
  actions: {
    /** Resolves true once the Pond has started saying a code. */
    ask: () => Promise<boolean>;
    /** Forget what was said, for another Pond: its code is not this one's. */
    reset: () => void;
  };
}

export function useSpokenCode(): UseSpokenCode {
  const { t } = useTranslation();
  const { requestSpokenCode } = useServer();
  const [asking, setAsking] = useState(false);
  // Kept through a later refusal: the code already said is still good for its ten minutes.
  const [said, setSaid] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; waited: boolean } | null>(null);
  const { left, start, stop } = useCountdown();
  // A second tap must not send a second request: each one is a code the Pond says aloud.
  const inFlight = useRef(false);

  const ask = useCallback(async () => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setAsking(true);
    setFailure(null);
    stop();
    try {
      await requestSpokenCode();
      setSaid(true);
      return true;
    } catch (error) {
      const wait = refusalWait(error, 'spoken_code_limited');
      if (wait) start(wait);
      setFailure({ error, waited: wait !== null });
      return false;
    } finally {
      inFlight.current = false;
      setAsking(false);
    }
  }, [requestSpokenCode, start, stop]);

  const reset = useCallback(() => {
    stop();
    setSaid(false);
    setFailure(null);
  }, [stop]);

  // A wait that has run out has nothing left to say: asking again is the next step.
  const error = failure && !(failure.waited && left === 0)
    ? describeSpokenCodeFailure(failure.error, t, left)
    : null;

  const phase: SpokenCodePhase = asking ? 'asking' : said ? 'spoken' : 'idle';
  return {
    data: { phase, waitSecs: left },
    loading: asking,
    error,
    actions: { ask, reset },
  };
}
