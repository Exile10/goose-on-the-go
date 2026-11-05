/**
 * Whether the paired Pond said it can do something (`routines`), from what it answered at pairing
 * or its last token refresh. Null until it has said: a phone paired before the Pond said anything
 * learns at its next refresh, so callers keep whatever other sign they had.
 */

import { useEffect, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { capabilitiesFor, onCapabilities } from '@/services/pond-capabilities';

export function usePondCapability(name: string): boolean | null {
  const { pairedPin } = useServer();
  const [capabilities, setCapabilities] = useState<string[] | null>(null);

  useEffect(() => {
    let live = true;
    const read = async () => {
      const next = pairedPin ? await capabilitiesFor(pairedPin) : null;
      if (live) setCapabilities(next);
    };
    // After this render, not inside it: reading sets state.
    void Promise.resolve().then(read);
    const off = onCapabilities(() => void read());
    return () => {
      live = false;
      off();
    };
  }, [pairedPin]);

  return capabilities ? capabilities.includes(name) : null;
}
