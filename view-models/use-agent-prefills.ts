// Quick while a compile pass runs and slow otherwise, since a pass starts only on a Pond start, a save
// or a rebuild. A 404 is not asked again: a missing route will not appear between two polls.

import { useCallback, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError } from '@/services/api-client';
import type { AgentPrefills, PrefillBuilding } from '@/services/types';
import { isMissingRoute, useAgentsSource } from './agents-source';
import { MIN_POLL_MS, useLive } from './use-live';

/** While a pass runs: the poll floor, about twelve requests a minute, on one screen at a time. */
export const PREFILLS_BUILDING_MS = MIN_POLL_MS;
/** Home, when nothing is compiling: soon enough to see a pass the Pond started on its own. */
export const PREFILLS_HOME_MS = 30_000;
/** The agents screens, which someone opens to watch and acts on, so a rebuild shows quickly. */
export const PREFILLS_SCREEN_MS = 15_000;

export function prefillsDelay(state: AgentPrefills | null, idleMs: number): number {
  return state?.building.active ? PREFILLS_BUILDING_MS : idleMs;
}

export interface UsePrefills {
  /** Null until the Pond has answered once. */
  prefills: AgentPrefills | null;
  /** The Pond has no prefill routes. Everything else about agents still works. */
  unsupported: boolean;
  /** Read now, after an action that changes what the Pond reports. */
  reload: () => Promise<void>;
}

/** For the log: the status, never the Pond's sentence. */
function statusOf(e: unknown): number | 'network' | 'shape' {
  if (e instanceof ApiError) return e.status;
  return e instanceof TypeError ? 'network' : 'shape';
}

export function usePrefills(idleMs: number, enabled = true): UsePrefills {
  const { hydrated } = useServer();
  const source = useAgentsSource();
  const [prefills, setPrefills] = useState<AgentPrefills | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const latest = useRef<AgentPrefills | null>(null);

  // The Developer toggle swapping the source: nothing read from the old one describes the new one.
  const [from, setFrom] = useState(source);
  if (from !== source) {
    setFrom(source);
    setPrefills(null);
    setUnsupported(false);
  }

  const read = useCallback(async () => {
    try {
      const next = await source.prefills();
      latest.current = next;
      setPrefills(next);
    } catch (e) {
      if (isMissingRoute(e)) setUnsupported(true);
      else console.warn('[agents] prefill read failed', { status: statusOf(e) });
    }
  }, [source]);

  useLive(read, () => prefillsDelay(latest.current, idleMs), enabled && hydrated && !unsupported);

  return { prefills, unsupported, reload: read };
}

/** Home's question: is the Pond compiling agents right now, and how far has it got? */
export function useAgentsBuilding(): PrefillBuilding | null {
  const { online } = useServer();
  const { prefills } = usePrefills(PREFILLS_HOME_MS, online);
  const building = prefills?.building;
  // A Pond out of reach is not known to be compiling, whatever it said last.
  return online && building?.active ? building : null;
}
