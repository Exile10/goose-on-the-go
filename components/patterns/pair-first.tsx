/**
 * Sends an app with no paired Pond to pairing, once.
 *
 * A fresh install landed on Home with nothing behind it, and the only route to
 * pairing was noticing that the thin banner at the top is tappable. Pairing is
 * not a setting this app has; it is the thing that has to happen before any of
 * it works.
 *
 * Waits for `hydrated`, which is what says the stored profile has been read
 * back. Without it every cold start would flash the pairing wizard before
 * discovering it is already paired.
 *
 * Navigates once per unpaired spell, not once per render: `unpaired` persists
 * for as long as nothing is paired, and re-pushing on every render would trap
 * the user on a screen they are trying to leave. Leaving pairing is allowed --
 * somebody may want to look around first -- and the banner is still there to
 * bring them back.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';

import { useServer } from '@/providers/server-provider';

export function PairFirst() {
  const { connectionState, hydrated } = useServer();
  const router = useRouter();
  const sent = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    if (connectionState !== 'unpaired') {
      // Paired again, so a later sign-out gets its own trip.
      sent.current = false;
      return;
    }
    if (sent.current) return;
    sent.current = true;
    router.push('/(stack)/pond-pairing');
  }, [connectionState, hydrated, router]);

  return null;
}
