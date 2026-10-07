import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';

import { api } from '@/services/api-client';
import type { RidePoint } from '@/services/types';
import {
  cancel as cancelStep,
  confirm as confirmStep,
  decline as declineStep,
  getFare as getFareStep,
  isFinished,
  refresh,
  type Locate,
  type RideView,
} from '@/models/ride-flow';

/** How often a booked ride is re-read while this screen is open. */
const FOLLOW_INTERVAL_MS = 10_000;

/** The phone's location, asked for only now and only while the app is open. */
const locateHere: Locate = async () => {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) return null;
  const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { latitude: coords.latitude, longitude: coords.longitude };
};

/** A ride the Pond offered, from fare to finish. `busy` is true while a step is in flight. */
export function useRide(dropoff: RidePoint) {
  const [view, setView] = useState<RideView>({ phase: 'offer' });
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (step: () => Promise<RideView>) => {
    setBusy(true);
    try {
      setView(await step());
    } finally {
      setBusy(false);
    }
  }, []);

  const getFare = useCallback(() => run(() => getFareStep(api, locateHere, dropoff)), [run, dropoff]);
  const confirm = useCallback(
    () => view.phase === 'quoted' ? run(() => confirmStep(api, view.quote)) : Promise.resolve(),
    [run, view],
  );
  const decline = useCallback(
    () => view.phase === 'quoted' ? run(() => declineStep(api, view.quote)) : Promise.resolve(),
    [run, view],
  );
  const cancel = useCallback(
    () => view.phase === 'booked' ? run(() => cancelStep(api, view.quote)) : Promise.resolve(),
    [run, view],
  );

  // Follow a booked ride while the screen is open; the Pond also sends each change as a notification.
  const following = view.phase === 'booked' && !isFinished(view.ride.status);
  useEffect(() => {
    if (!following) return;
    const timer = setInterval(() => {
      void refresh(api, view).then(setView);
    }, FOLLOW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [following, view]);

  return { view, busy, getFare, confirm, decline, cancel };
}
