/**
 * The connection's state as every surface tells it -- the strip, a stack screen's inline strip and
 * the Pond card on Home and Switch Pond -- so they cannot disagree, with the one action that helps.
 *
 * The countdown is live: while a check is due, this re-renders once a second, and only then.
 */

import { useCallback, useEffect, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { selectionTick } from '@/services/haptics';
import { logFailure } from '@/view-models/describe-error';
import { connectionWords, type ConnectionWords } from '@/view-models/connection-words';

export interface ConnectionStatusView extends ConnectionWords {
  /** Whether the saved pairing has been read back; before it, the state is a placeholder. */
  hydrated: boolean;
  /** Check now, restarting the back-off. */
  tryNow: () => void;
}

const TICK_MS = 1_000;

export function useConnectionStatus(): ConnectionStatusView {
  const { connectionState, connectionOutage, retryNow, hydrated } = useServer();
  const [now, setNow] = useState(() => Date.now());
  const counting = connectionState !== 'reconnecting' && connectionOutage?.nextCheckAt != null;

  useEffect(() => {
    setNow(Date.now());
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [counting, connectionOutage]);

  const tryNow = useCallback(() => {
    void selectionTick();
    retryNow().catch((e: unknown) => logFailure('connection', 'check asked for failed', e));
  }, [retryNow]);

  return { ...connectionWords(connectionState, connectionOutage, now), hydrated, tryNow };
}
