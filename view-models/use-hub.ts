// Whether this Pond serves My Goose's hub (`GET /me/hub`). A Pond without the route answers 404 and
// the phone keeps its older My Goose. The answer is kept per source for the session, so each hub
// screen does not ask again, and asked again when the tab comes back after a while.

import { useCallback, useEffect, useState } from 'react';

import type { MeHub } from '@/models/hub';
import { useServer } from '@/providers/server-provider';
import { isMissingRoute } from './agents-source';
import { logFailure } from './describe-error';
import { useHubSource, type HubSource } from './hub-source';

export type HubState = 'probing' | 'served' | 'absent' | 'failed';

/** A Pond gains the hub with an update, so a known answer is asked again after this long. */
export const HUB_RECHECK_MS = 10 * 60_000;

interface Known {
  state: HubState;
  hub: MeHub | null;
  at: number;
}

const known = new Map<HubSource, Map<string, Known>>();
const listeners = new Set<() => void>();
const inFlight = new Map<HubSource, Map<string, Promise<void>>>();

function remember(source: HubSource, url: string, value: Known) {
  const forSource = known.get(source) ?? new Map<string, Known>();
  forSource.set(url, value);
  known.set(source, forSource);
  listeners.forEach((l) => l());
}

async function probe(source: HubSource, url: string): Promise<void> {
  const running = inFlight.get(source)?.get(url);
  if (running) return running;
  const run = (async () => {
    try {
      const hub = await source.hub();
      remember(source, url, { state: hub ? 'served' : 'absent', hub, at: Date.now() });
    } catch (e) {
      if (isMissingRoute(e)) {
        remember(source, url, { state: 'absent', hub: null, at: Date.now() });
      } else {
        logFailure('hub', 'probe failed', e);
        const before = known.get(source)?.get(url);
        // A Pond that answered once keeps that answer through a dropped read.
        remember(source, url, before && before.state !== 'probing' ? { ...before, at: Date.now() } : { state: 'failed', hub: null, at: Date.now() });
      }
    } finally {
      inFlight.get(source)?.delete(url);
    }
  })();
  inFlight.set(source, (inFlight.get(source) ?? new Map()).set(url, run));
  return run;
}

/** For tests: forget every answer. */
export function resetHubProbe(): void {
  known.clear();
  inFlight.clear();
}

export interface UseHub {
  state: HubState;
  hub: MeHub | null;
  /** The hub is served: draw the hub's screens, not the older ones. */
  served: boolean;
  recheck: () => Promise<void>;
}

export function useHub(): UseHub {
  const { hydrated, serverUrl } = useServer();
  const source = useHubSource();
  const read = useCallback(() => known.get(source)?.get(serverUrl) ?? null, [source, serverUrl]);
  const [value, setValue] = useState<Known | null>(read);

  useEffect(() => {
    const listener = () => setValue(read());
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, [read]);

  useEffect(() => {
    if (!hydrated) return;
    const current = known.get(source)?.get(serverUrl);
    if (!current || current.state === 'failed' || Date.now() - current.at > HUB_RECHECK_MS) void probe(source, serverUrl);
  }, [hydrated, source, serverUrl]);

  const recheck = useCallback(() => probe(source, serverUrl), [source, serverUrl]);
  const state = value?.state ?? 'probing';
  return { state, hub: value?.hub ?? null, served: state === 'served', recheck };
}
