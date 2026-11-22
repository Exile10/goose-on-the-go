/**
 * Find your Pond: pick a new Pond, give it the card's code (scanned, typed, or said aloud by the
 * Pond), and claim it, all on one screen. A scanned card picks its own Pond and claims at once.
 * The phone's name defaults to the device's own and is changed on the same screen. A Pond that
 * is already someone's is asked to pair with a code it says aloud, and when its pairing lock
 * holds this phone, the wait for its main member is on the same row.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Device from 'expo-device';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useCountdown } from '@/hooks/use-countdown';
import { channelErrorKey, defaultPhoneName } from '@/models/ble-setup';
import { keepPicked, type NearbyPond } from '@/models/nearby-pond';
import type { HeldPairing } from '@/models/pairing-lock';
import { useServer } from '@/providers/server-provider';
import { ApiError } from '@/services/api-client';
import { BleUnreachableError, connectPond, WrongPondError } from '@/services/ble';
import { devicePassword, type PakeCredential } from '@/services/cpace';
import { findPondBySetupId } from '@/services/discovery';
import { confirm, reject } from '@/services/haptics';
import { getInstallId } from '@/services/install-id';
import { takeSetupCard } from '@/services/pairing-handoff';
import { SetupChannelClosed } from '@/services/setup-channel/session';
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
  | { kind: 'claiming'; pondId: string; resuming?: boolean }
  /** The Pond's pairing lock holds this phone until its main member lets it in. */
  | { kind: 'waiting'; pondId: string; held: HeldPairing }
  | { kind: 'failed'; pondId: string; credential: PakeCredential; message: string };

export interface UseFindPond {
  data: {
    /** The nearby Ponds, the picked one kept even once it stops being heard. */
    ponds: NearbyPond[];
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
    pickBle: (pond: NearbyPond) => void;
    submit: (code: string) => void;
    /** Have the picked Pond say a six-digit code, then type that instead of the card's. */
    askSpoken: () => void;
    /** Back to the card's code after a spoken one. */
    useCard: () => void;
    setPhoneName: (name: string) => void;
    cancel: () => void;
    /** The held pairing was let in and kept: go on as after any pairing. */
    heldPaired: () => void;
    /** The wait ended without a pairing: back to a code, since the last one is spent. */
    askAgain: () => void;
  };
}

// Long enough for a Pond just switched on to start advertising; the search carries on after it.
const LOOKING_MS = 15_000;

/** `rescan` restarts the Bluetooth scan, which connecting to a Pond stops. */
export function useFindPond(fresh: NearbyPond[], rescan?: () => void): UseFindPond {
  const { t } = useTranslation();
  const router = useRouter();
  const { stagePairing, pair, requestSpokenCode, cancelPairing, pairedPin, refreshToken, keepRotatedTokens } = useServer();
  const waitingRef = useRef(false);
  const [phase, setPhase] = useState<FindPhase>({ kind: 'browsing' });
  const [phoneName, setPhoneName] = useState(() => defaultPhoneName(Device.deviceName, Device.modelName));
  const [spoken, setSpoken] = useState<{ asking: boolean; error: string | null }>({ asking: false, error: null });
  const [claimedIds, setClaimedIds] = useState<string[]>([]);
  const { left: coolingSecs, start: startCooling, stop: stopCooling } = useCountdown();
  const { left: spokenWaitSecs, start: startSpokenWait } = useCountdown();
  const card = useRef<{ id: string; code: string } | null>(null);
  const driver = useRef<{ pondId: string; claim: ClaimDriver } | null>(null);
  const [chosen, setChosen] = useState<NearbyPond | null>(null);
  const listed = useMemo(() => keepPicked(fresh, chosen), [fresh, chosen]);
  const ponds = useRef(listed);
  useEffect(() => {
    ponds.current = listed;
  }, [listed]);

  const driverFor = useCallback(
    (pond: NearbyPond, forceBle = false): ClaimDriver => {
      if (!forceBle && driver.current?.pondId === pond.id) return driver.current.claim;
      driver.current?.claim.close();
      const claim = !forceBle && prefersNetwork(pond)
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
      // The Pond ended it (a refused write, the 10-minute cap, a dropped link); the next try connects afresh.
      if (e instanceof SetupChannelClosed) return t('bleSetup.find.sessionEnded');
      const channel = e instanceof ApiError ? channelErrorKey(e.detail) : null;
      if (channel) return t(channel);
      return describePairingFailure(e, t, credential);
    },
    [t],
  );

  /**
   * Where a held request is answered: the home network. A request made over Bluetooth is followed
   * there by finding the Pond under its card id and the pin its hello gave, which the exchange proved.
   */
  const reachHeld = useCallback(
    async (pond: NearbyPond, run: ClaimDriver): Promise<boolean> => {
      if (run.transport === 'network') return true;
      try {
        const greeted = await run.greet();
        const found = await findPondBySetupId(pond.id);
        if (!greeted?.pin || !found?.pin || found.pin !== greeted.pin) return false;
        const url = new URL(found.url);
        await stagePairing({ version: 2, host: url.hostname, port: Number(url.port) || 443, localUrls: [found.url] }, found.pin);
        return true;
      } catch {
        return false;
      } finally {
        run.close();
        if (driver.current?.claim === run) driver.current = null;
      }
    },
    [stagePairing],
  );

  const claim = useCallback(
    async (pond: NearbyPond, credential: PakeCredential, code: string) => {
      setChosen(pond);
      setPhase({ kind: 'claiming', pondId: pond.id });
      stopCooling();
      let run = driverFor(pond);
      try {
        const clientId = await getInstallId();
        const request = { credential, code, clientId, deviceName: phoneName.trim() || defaultPhoneName(Device.deviceName, Device.modelName) };
        let resp;
        try {
          resp = await run.claim(request);
        } catch (firstErr) {
          if (run.transport === 'network' && !(firstErr instanceof ApiError) && pond.peripheral) {
            run = driverFor(pond, true);
            resp = await run.claim(request);
          } else {
            throw firstErr;
          }
        }
        if (!resp.accepted && resp.held) {
          if (await reachHeld(pond, run)) {
            waitingRef.current = true;
            setPhase({ kind: 'waiting', pondId: pond.id, held: resp.held });
          } else {
            void reject();
            setPhase({ kind: 'failed', pondId: pond.id, credential: 'pairing', message: t('pairingLock.refused.needsNetwork') });
          }
          return;
        }
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
    [stopCooling, startCooling, describe, driverFor, phoneName, reachHeld, router, t],
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

  /**
   * A `device` run for a Pond this phone is paired with. It rotates the pair, so the new one is kept at
   * once, before Wi-Fi: leaving then still leaves a working pairing. False sends the household to the
   * spoken code, which also covers a refresh token the Pond no longer recognises.
   */
  const resume = useCallback(
    async (pond: NearbyPond, run: ClaimDriver, token: string): Promise<boolean> => {
      setPhase({ kind: 'claiming', pondId: pond.id, resuming: true });
      try {
        const clientId = await getInstallId();
        const resp = await run.claim({ credential: 'device', code: devicePassword(token), clientId, deviceName: phoneName.trim() });
        if (!resp.accepted || !resp.session_token || !resp.refresh_token) return false;
        keepRotatedTokens(resp.session_token, resp.refresh_token);
        void confirm();
        driver.current = null;
        router.replace('/(onboarding)/pond-wifi');
        return true;
      } catch (e) {
        const wait = refusalWait(e, 'device_cooling');
        if (wait) setSpoken({ asking: false, error: t('pairingErrors.deviceCooling', { count: wait }) });
        return false;
      }
    },
    [keepRotatedTokens, phoneName, router, t],
  );

  /** Let go of a wait: the Pond staged for it over the home network is no longer wanted. */
  const dropWait = useCallback(() => {
    if (!waitingRef.current) return;
    waitingRef.current = false;
    void cancelPairing();
  }, [cancelPairing]);

  const pick = useCallback(
    (pond: NearbyPond, forceBle = false) => {
      dropWait();
      setSpoken({ asking: false, error: null });
      setChosen(pond);
      if (card.current?.id === pond.id) {
        void claim(pond, 'setup', card.current.code);
        return;
      }
      const run = driverFor(pond, forceBle);
      if (run.transport === 'network') {
        if (pond.claimed) setClaimedIds((ids) => (ids.includes(pond.id) ? ids : [...ids, pond.id]));
        setPhase({ kind: 'entering', pondId: pond.id, credential: pond.claimed ? 'pairing' : 'setup', spoken: false });
        return;
      }
      // Over Bluetooth a Pond that lost its network advertises too; only hello says whose it is.
      setPhase({ kind: 'connecting', pondId: pond.id });
      void (async () => {
        try {
          const greeted = await run.greet();
          const claimed = greeted?.claimed ?? false;
          if (claimed) setClaimedIds((ids) => (ids.includes(pond.id) ? ids : [...ids, pond.id]));
          // This phone's own Pond, by its pin: it can come back in on its refresh token, with no code.
          if (claimed && greeted && refreshToken && greeted.pin === pairedPin && (await resume(pond, run, refreshToken))) return;
          setPhase({ kind: 'entering', pondId: pond.id, credential: claimed ? 'pairing' : 'setup', spoken: false });
        } catch (e) {
          void reject();
          setPhase({ kind: 'failed', pondId: pond.id, credential: 'setup', message: describe(e, 'setup') });
        }
      })();
    },
    [claim, describe, driverFor, dropWait, pairedPin, refreshToken, resume],
  );

  const picked = (): NearbyPond | null => {
    const id = phase.kind === 'browsing' || phase.kind === 'looking' ? null : phase.pondId;
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
    dropWait();
    card.current = null;
    stopCooling();
    setSpoken({ asking: false, error: null });
    setChosen(null);
    setPhase({ kind: 'browsing' });
    rescan?.();
  }, [stopCooling, rescan, dropWait]);

  useEffect(() => dropWait, [dropWait]);

  const heldPaired = useCallback(() => {
    void confirm();
    // The pairing is kept, so there is nothing staged left to cancel.
    waitingRef.current = false;
    card.current = null;
    driver.current = null;
    void setupNeededNow().then((needed) => router.replace(needed ? '/(onboarding)/owner-setup' : '/(tabs)'));
  }, [router]);

  const askAgain = useCallback(() => {
    if (phase.kind !== 'waiting') return;
    driver.current?.claim.close();
    driver.current = null;
    dropWait();
    setClaimedIds((ids) => (ids.includes(phase.pondId) ? ids : [...ids, phase.pondId]));
    setPhase({ kind: 'entering', pondId: phase.pondId, credential: 'pairing', spoken: false });
  }, [phase, dropWait]);

  const pickBle = useCallback((pond: NearbyPond) => pick(pond, true), [pick]);

  return {
    data: { ponds: listed, phase, claimedIds, phoneName, coolingSecs, spoken },
    actions: { pick, pickBle, submit, askSpoken, useCard, setPhoneName, cancel, heldPaired, askAgain },
  };
}
