/**
 * Find your Pond: pick a new Pond, give it the card's code (scanned, typed, or said aloud by the
 * Pond), and claim it, all on one screen. A scanned card picks its own Pond and claims at once.
 * The phone's name defaults to the device's own and is changed on the same screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Device from 'expo-device';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useCountdown } from '@/hooks/use-countdown';
import { channelErrorKey, defaultPhoneName } from '@/models/ble-setup';
import type { NearbyPond } from '@/models/nearby-pond';
import { useServer } from '@/providers/server-provider';
import { ApiError } from '@/services/api-client';
import { BleUnreachableError, connectPond, WrongPondError } from '@/services/ble';
import type { PakeCredential } from '@/services/cpace';
import { confirm, reject } from '@/services/haptics';
import { getInstallId } from '@/services/install-id';
import { takeSetupCard } from '@/services/pairing-handoff';
import { holdSetup } from '@/services/setup-session';
import {
  describePairingFailure,
  describeSpokenCodeFailure,
  explainRefusedPairing,
  isClaimedRefusal,
  refusalWait,
} from './pairing-errors';
import { bleClaim, networkClaim, prefersNetwork, type ClaimDriver } from './pond-claim';
import { setupNeededNow } from './use-setup-gate';

export type FindPhase =
  /** Nothing picked yet. */
  | { kind: 'browsing' }
  /** A card was scanned and its Pond has not been heard yet. */
  | { kind: 'looking'; cardId: string; late: boolean }
  /** Connecting over Bluetooth to learn whether the picked Pond is new or someone's. */
  | { kind: 'connecting'; pondId: string }
  /** A Pond is picked and the code is being typed. */
  | { kind: 'entering'; pondId: string; credential: PakeCredential; spoken: boolean }
  | { kind: 'claiming'; pondId: string }
  | { kind: 'failed'; pondId: string; credential: PakeCredential; message: string };

export interface UseFindPond {
  data: {
    phase: FindPhase;
    /** Ponds whose hello said they are already someone's: these need a spoken code, then Wi-Fi. */
    claimedIds: string[];
    phoneName: string;
    /** Seconds until the Pond takes another setup code, after wrong ones. */
    coolingSecs: number;
    /** Asking the Pond to say a code, or why it would not. */
    spoken: { asking: boolean; error: string | null };
  };
  actions: {
    pick: (pond: NearbyPond) => void;
    submit: (code: string) => void;
    /** Have the picked Pond say a six-digit code, then type that instead of the card's. */
    askSpoken: () => void;
    /** Back to the card's code after a spoken one. */
    useCard: () => void;
    setPhoneName: (name: string) => void;
    cancel: () => void;
  };
}

// Long enough for a Pond just switched on to start advertising; the search carries on after it.
const LOOKING_MS = 15_000;

export function useFindPond(fresh: NearbyPond[]): UseFindPond {
  const { t } = useTranslation();
  const router = useRouter();
  const { stagePairing, pair, requestSpokenCode, cancelPairing } = useServer();
  const [phase, setPhase] = useState<FindPhase>({ kind: 'browsing' });
  const [phoneName, setPhoneName] = useState(() => defaultPhoneName(Device.deviceName, Device.modelName));
  const [spoken, setSpoken] = useState<{ asking: boolean; error: string | null }>({ asking: false, error: null });
  const [claimedIds, setClaimedIds] = useState<string[]>([]);
  const { left: coolingSecs, start: startCooling, stop: stopCooling } = useCountdown();
  const { left: spokenWaitSecs, start: startSpokenWait } = useCountdown();
  const card = useRef<{ id: string; code: string } | null>(null);
  const driver = useRef<{ pondId: string; claim: ClaimDriver } | null>(null);
  const ponds = useRef(fresh);
  useEffect(() => {
    ponds.current = fresh;
  }, [fresh]);

  const driverFor = useCallback(
    (pond: NearbyPond): ClaimDriver => {
      if (driver.current?.pondId === pond.id) return driver.current.claim;
      driver.current?.claim.close();
      const claim = prefersNetwork(pond)
        ? networkClaim(pond, { stage: stagePairing, pair, requestSpokenCode, cancel: cancelPairing })
        : bleClaim(pond, { connect: connectPond, hold: holdSetup });
      driver.current = { pondId: pond.id, claim };
      return claim;
    },
    [stagePairing, pair, requestSpokenCode, cancelPairing],
  );

  useEffect(() => () => driver.current?.claim.close(), []);

  const describe = useCallback(
    (e: unknown, credential: PakeCredential) => {
      if (e instanceof BleUnreachableError) return t('bleSetup.find.unreachable');
      if (e instanceof WrongPondError) return t('bleSetup.find.wrongPond');
      const channel = e instanceof ApiError ? channelErrorKey(e.detail) : null;
      if (channel) return t(channel);
      return describePairingFailure(e, t, credential);
    },
    [t],
  );

  const claim = useCallback(
    async (pond: NearbyPond, credential: PakeCredential, code: string) => {
      setPhase({ kind: 'claiming', pondId: pond.id });
      stopCooling();
      const run = driverFor(pond);
      try {
        const clientId = await getInstallId();
        const resp = await run.claim({ credential, code, clientId, deviceName: phoneName.trim() || defaultPhoneName(Device.deviceName, Device.modelName) });
        if (!resp.accepted) {
          void reject();
          // Another phone claimed it between the card and now: only a spoken code joins it.
          const claimedNow = resp.rejection_reason === 'setup_code_unavailable';
          if (claimedNow) setClaimedIds((ids) => (ids.includes(pond.id) ? ids : [...ids, pond.id]));
          setPhase({ kind: 'failed', pondId: pond.id, credential: claimedNow ? 'pairing' : credential, message: explainRefusedPairing(resp.rejection_reason, t, credential) });
          return;
        }
        void confirm();
        card.current = null;
        driver.current = null;
        if (run.transport === 'ble') {
          router.replace('/(onboarding)/pond-wifi');
          return;
        }
        router.replace((await setupNeededNow()) ? '/(onboarding)/owner-setup' : '/(tabs)');
      } catch (e) {
        void reject();
        const wait = refusalWait(e, 'setup_code_cooling');
        if (wait) startCooling(wait);
        if (isClaimedRefusal(e)) setClaimedIds((ids) => (ids.includes(pond.id) ? ids : [...ids, pond.id]));
        setPhase({ kind: 'failed', pondId: pond.id, credential: isClaimedRefusal(e) ? 'pairing' : credential, message: describe(e, credential) });
      }
    },
    [stopCooling, startCooling, describe, driverFor, phoneName, router, t],
  );

  // A scanned card comes back here from the scanner, and names the Pond it belongs to.
  useFocusEffect(
    useCallback(() => {
      const scanned = takeSetupCard();
      if (!scanned) return;
      card.current = { id: scanned.id, code: scanned.code };
      setPhase({ kind: 'looking', cardId: scanned.id, late: false });
    }, []),
  );

  // Claim the card's Pond the moment it is heard, however it is heard.
  useEffect(() => {
    if (phase.kind !== 'looking') return;
    const pond = fresh.find((p) => p.id === phase.cardId);
    const held = card.current;
    if (pond && held) {
      void claim(pond, 'setup', held.code);
      return;
    }
    if (phase.late) return;
    const timer = setTimeout(() => setPhase((p) => (p.kind === 'looking' ? { ...p, late: true } : p)), LOOKING_MS);
    return () => clearTimeout(timer);
  }, [phase, fresh, claim]);

  const pick = useCallback(
    (pond: NearbyPond) => {
      setSpoken({ asking: false, error: null });
      if (card.current?.id === pond.id) {
        void claim(pond, 'setup', card.current.code);
        return;
      }
      const run = driverFor(pond);
      if (run.transport === 'network') {
        setPhase({ kind: 'entering', pondId: pond.id, credential: 'setup', spoken: false });
        return;
      }
      // Over Bluetooth a Pond that lost its network advertises too; only hello says whose it is.
      setPhase({ kind: 'connecting', pondId: pond.id });
      void (async () => {
        try {
          const greeted = await run.greet();
          const claimed = greeted?.claimed ?? false;
          if (claimed) setClaimedIds((ids) => (ids.includes(pond.id) ? ids : [...ids, pond.id]));
          setPhase({ kind: 'entering', pondId: pond.id, credential: claimed ? 'pairing' : 'setup', spoken: false });
        } catch (e) {
          void reject();
          setPhase({ kind: 'failed', pondId: pond.id, credential: 'setup', message: describe(e, 'setup') });
        }
      })();
    },
    [claim, describe, driverFor],
  );

  const picked = (): NearbyPond | null => {
    const id = phase.kind === 'entering' || phase.kind === 'failed' || phase.kind === 'claiming' || phase.kind === 'connecting' ? phase.pondId : null;
    return ponds.current.find((p) => p.id === id) ?? null;
  };

  const submit = (code: string) => {
    const pond = picked();
    if (!pond || (phase.kind !== 'entering' && phase.kind !== 'failed')) return;
    void claim(pond, phase.credential, code);
  };

  const askSpoken = () => {
    const pond = picked();
    if (!pond || spoken.asking || spokenWaitSecs > 0) return;
    setSpoken({ asking: true, error: null });
    void (async () => {
      const run = driverFor(pond);
      try {
        if (!(await run.canSpeak())) {
          setSpoken({ asking: false, error: t('pairingErrors.spokenDisabled') });
          return;
        }
        await run.speak();
        setSpoken({ asking: false, error: null });
        setPhase({ kind: 'entering', pondId: pond.id, credential: 'pairing', spoken: true });
      } catch (e) {
        const wait = refusalWait(e, 'spoken_code_limited');
        if (wait) startSpokenWait(wait);
        setSpoken({ asking: false, error: e instanceof BleUnreachableError ? t('bleSetup.find.unreachable') : describeSpokenCodeFailure(e, t, wait ?? 0) });
      }
    })();
  };

  const useCard = () => {
    const pond = picked();
    if (pond) setPhase({ kind: 'entering', pondId: pond.id, credential: 'setup', spoken: false });
  };

  const cancel = useCallback(() => {
    driver.current?.claim.close();
    driver.current = null;
    card.current = null;
    stopCooling();
    setSpoken({ asking: false, error: null });
    setPhase({ kind: 'browsing' });
  }, [stopCooling]);

  return {
    data: { phase, claimedIds, phoneName, coolingSecs, spoken },
    actions: { pick, submit, askSpoken, useCard, setPhoneName, cancel },
  };
}
