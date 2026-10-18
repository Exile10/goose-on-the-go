/**
 * Searching the local network for Ponds, for the pairing wizard's first step.
 *
 * Follows the view-model contract in docs/ARCHITECTURE.md: the screen renders
 * `data` and calls `actions`, and never touches the network itself.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  SEARCH_TIMEOUT_MS,
  startDiscovery,
  type DiscoveredPond,
  type DiscoveryHandle,
} from '@/services/discovery';

export type DiscoveryPhase = 'searching' | 'found' | 'empty' | 'failed';

export interface UseDiscovery {
  data: {
    ponds: DiscoveredPond[];
    phase: DiscoveryPhase;
  };
  loading: boolean;
  error: string | null;
  actions: {
    /** Search again, clearing what was found. */
    retry: () => void;
  };
}

export function useDiscovery(): UseDiscovery {
  const [ponds, setPonds] = useState<DiscoveredPond[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const handle = useRef<DiscoveryHandle | null>(null);

  useEffect(() => {
    setPonds([]);
    setError(null);
    setTimedOut(false);

    handle.current = startDiscovery(setPonds, setError);
    const timer = setTimeout(() => setTimedOut(true), SEARCH_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      // Always release: a live browse holds a multicast lock on Android, and
      // leaving one running costs battery for as long as the app is alive.
      handle.current?.stop();
      handle.current = null;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // A hub that answered is worth showing even if something else errored, so
  // results outrank a failure rather than the other way round.
  const phase: DiscoveryPhase =
    ponds.length > 0 ? 'found' : error ? 'failed' : timedOut ? 'empty' : 'searching';

  return {
    data: { ponds, phase },
    loading: phase === 'searching',
    error,
    actions: { retry },
  };
}
