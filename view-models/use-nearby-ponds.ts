/**
 * Every Pond the first screen can offer: new ones heard over Bluetooth or seen on this network with
 * `setup=1`, and the ones already set up, for joining. Bluetooth scans only while the screen is in
 * front, since a scan costs battery and Android limits how often one may start.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { mergeNearby, pruneSightings, type BleSightingLike, type NearbyPond } from '@/models/nearby-pond';
import { bleAvailable, bleState, onBleState, requestBlePermission, scanForPonds, type BleState } from '@/services/ble';
import type { DiscoveredPond } from '@/services/discovery';
import { useDiscovery, type DiscoveryPhase } from './use-discovery';

/** What Bluetooth is doing for this screen, so the screen can say why nothing nearby shows. */
export type BleScan = 'starting' | 'scanning' | 'off' | 'denied' | 'unsupported' | 'failed';

export interface UseNearbyPonds {
  data: {
    /** New Ponds, one row per card id. */
    fresh: NearbyPond[];
    /** Ponds on this network that are already set up. */
    joinable: DiscoveredPond[];
    ble: BleScan;
    network: DiscoveryPhase;
  };
  loading: boolean;
  error: string | null;
  actions: {
    retry: () => void;
    /** Ask again for Bluetooth, or open Settings when the system will not ask twice. */
    fixBluetooth: () => void;
  };
}

const PRUNE_MS = 5_000;

function scanOf(state: BleState): BleScan {
  switch (state) {
    case 'unauthorized':
      return 'denied';
    case 'off':
      return 'off';
    case 'unsupported':
      return 'unsupported';
    default:
      return 'starting';
  }
}

type Sightings = Map<string, BleSightingLike & { seenAt: number }>;

export function useNearbyPonds(): UseNearbyPonds {
  const discovery = useDiscovery();
  const [ble, setBle] = useState<BleScan>(bleAvailable() ? 'starting' : 'unsupported');
  const [sightings, setSightings] = useState<Sightings>(() => new Map());
  const asked = useRef(false);
  const restart = useRef<(() => void) | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!bleAvailable()) return;
      let stop: (() => void) | null = null;
      let cancelled = false;

      const halt = (next: BleScan) => {
        stop?.();
        stop = null;
        setBle(next);
        // A Pond heard before Bluetooth went away is not known to be there now.
        if (next === 'off' || next === 'denied') setSightings(new Map());
      };

      // One start at a time: returning to the app (a link, a permission dialog) fires while the
      // first is still asking, and two would leave two subscriptions and every sighting twice.
      let starting = false;
      const start = async () => {
        if (starting) return;
        starting = true;
        try {
          await begin();
        } finally {
          starting = false;
        }
      };

      const begin = async () => {
        stop?.();
        stop = null;
        setBle('starting');
        if (!asked.current) {
          asked.current = true;
          if (!(await requestBlePermission())) {
            if (!cancelled) halt('denied');
            return;
          }
        }
        const state = await bleState();
        if (cancelled) return;
        if (state !== 'on') {
          halt(scanOf(state));
          return;
        }
        try {
          const next = await scanForPonds(
            (s) =>
              setSightings((prev) =>
                new Map(prev).set(s.peripheral, { ...s, name: s.name ?? prev.get(s.peripheral)?.name ?? null, seenAt: Date.now() }),
              ),
            () => halt('failed'),
          );
          if (cancelled) next();
          else {
            stop = next;
            setBle('scanning');
          }
        } catch {
          if (!cancelled) halt('failed');
        }
      };

      restart.current = () => void start();
      void start();
      const offState = onBleState((state) => (state === 'on' ? void start() : halt(scanOf(state))));
      // Coming back from Settings is how a refused permission gets granted; Android says nothing else.
      const appState = AppState.addEventListener('change', (next) => {
        if (next === 'active' && !stop) void start();
      });
      const prune = setInterval(() => {
        setSightings((prev) => {
          const next = new Map(prev);
          return pruneSightings(next, Date.now()) ? next : prev;
        });
      }, PRUNE_MS);
      return () => {
        cancelled = true;
        restart.current = null;
        stop?.();
        offState();
        appState.remove();
        clearInterval(prune);
      };
    }, []),
  );

  const { ponds, phase } = discovery.data;
  const fresh = useMemo(() => mergeNearby(sightings, ponds), [sightings, ponds]);
  const joinable = useMemo(() => ponds.filter((p) => !p.unclaimed), [ponds]);
  const retryNetwork = discovery.actions.retry;

  const retry = useCallback(() => {
    setSightings(new Map());
    restart.current?.();
    retryNetwork();
  }, [retryNetwork]);

  const fixBluetooth = useCallback(() => {
    if (ble === 'denied') {
      // Both systems ask once; after a refusal only Settings can change it.
      void Linking.openSettings();
      return;
    }
    asked.current = false;
    restart.current?.();
  }, [ble]);

  return {
    data: { fresh, joinable, ble, network: phase },
    loading: ble === 'starting' || phase === 'searching',
    error: discovery.error,
    actions: { retry, fixBluetooth },
  };
}
