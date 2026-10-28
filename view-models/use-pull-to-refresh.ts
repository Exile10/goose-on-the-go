/**
 * The one way a screen of Pond content is refreshed by hand: a downward swipe.
 *
 * A pull does what the connection strip's Try again and the failed view's Try again did between
 * them, so neither needs a button. When the strip is up for a reason another attempt can help
 * (`connectionNeedsAttention` and not `connectionActionIsPairing`), the pull asks the connection
 * manager to look for the Pond first; then, whatever that found, it reads the screen again. A
 * revoked or unpaired phone skips the first step: a probe without a token would report the Pond
 * reachable and change nothing, and the strip's Pair is the action there.
 *
 * Every screen goes through this rather than holding its own `refreshing` flag, so a pull behaves
 * the same everywhere: the spinner stays up until both steps settle, a second pull while one is in
 * flight is ignored, and a reload that throws is logged and still lets the spinner go.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { connectionActionIsPairing, connectionNeedsAttention } from '@/models/connection';
import { useServer } from '@/providers/server-provider';
import { logFailure } from '@/view-models/describe-error';

export interface PullToRefresh {
  /** A pull is in flight. Hand both fields to `RefreshControl` as they are. */
  refreshing: boolean;
  onRefresh: () => void;
}

/** `reload` reads the screen's content again; it may return a promise, which the spinner waits on. */
export function usePullToRefresh(reload: () => unknown): PullToRefresh {
  const { hydrated, connectionState, recover } = useServer();
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const retryConnection = hydrated && connectionNeedsAttention(connectionState) && !connectionActionIsPairing(connectionState);

  const onRefresh = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    void (async () => {
      // A connection check that throws is no reason to skip the read: the read is what was asked for.
      if (retryConnection) {
        try {
          await recover();
        } catch (e) {
          logFailure('pull-to-refresh', 'connection check failed', e);
        }
      }
      try {
        await reload();
      } catch (e) {
        logFailure('pull-to-refresh', 'refresh failed', e);
      } finally {
        inFlight.current = false;
        setRefreshing(false);
      }
    })();
  }, [recover, reload, retryConnection]);

  return { refreshing, onRefresh };
}

/**
 * Sections that read their own content inside a scroll somebody else owns -- the Schedules and
 * Automations tabs under one segmented control, the camera's status card or the voice list on a
 * settings page. Each registers its read with `useReloadOnPull`, and the screen's pull reads them
 * all, so a hint that says "Pull down to try again" in a section is never a promise the pull does
 * not keep.
 */
type SectionReloads = Set<{ current: () => unknown }>;

const SectionContext = createContext<SectionReloads | null>(null);

/** Around the sections, with the `registry` from `usePullSections`. */
export const PullSectionsProvider = SectionContext.Provider;

export interface PullSections {
  registry: SectionReloads;
  /** Reads every registered section again; settles when they all have. */
  reload: () => Promise<unknown>;
}

/** For the screen that owns the scroll: pass `reload` (or a read that includes it) to `usePullToRefresh`. */
export function usePullSections(): PullSections {
  const [registry] = useState<SectionReloads>(() => new Set());
  const reload = useCallback(() => Promise.all([...registry].map((section) => section.current())), [registry]);
  return { registry, reload };
}

/** For a section: the screen's pull calls `reload`. Outside a `PullSectionsProvider` it does nothing. */
export function useReloadOnPull(reload: () => unknown): void {
  const registry = useContext(SectionContext);
  const latest = useRef(reload);
  useEffect(() => {
    latest.current = reload;
  }, [reload]);
  useEffect(() => {
    if (!registry) return;
    registry.add(latest);
    return () => {
      registry.delete(latest);
    };
  }, [registry]);
}
