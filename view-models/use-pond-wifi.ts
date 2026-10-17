/**
 * Telling a just-claimed Pond which Wi-Fi to join, over the setup channel the claim opened, then
 * moving to HTTPS at the address it reports. A Pond already on a network skips straight to that.
 *
 * The pairing is kept the moment there is an address, before anything is reached: the tokens exist
 * only in memory until then, and a phone that has not joined that network yet must not lose them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { handoverProfile, joinedAt, onlineAt, wifiChoices, wifiErrorKey, type PondAddress } from '@/models/ble-setup';
import { useServer } from '@/providers/server-provider';
import { ApiError } from '@/services/api-client';
import { confirm, reject } from '@/services/haptics';
import { SetupChannelClosed, type WifiNetwork } from '@/services/setup-channel/session';
import { heldSetup, releaseSetup } from '@/services/setup-session';
import { setupNeededNow } from './use-setup-gate';

export type WifiPhase =
  | { kind: 'checking' }
  | { kind: 'choosing'; scanning: boolean }
  | { kind: 'joining'; ssid: string }
  | { kind: 'handover'; ssid: string | null }
  | { kind: 'unreachable'; ssid: string | null; checking: boolean }
  /** The Bluetooth session ended before the Pond had an address. */
  | { kind: 'lost' };

export interface UsePondWifi {
  data: {
    phase: WifiPhase;
    networks: WifiNetwork[];
    /** Why the last join failed, in the Pond's own terms, for the network it was for. */
    failure: { ssid: string; message: string } | null;
    /** Why the Pond could not list networks, so an empty list is not mistaken for none in range. */
    scanFailure: string | null;
    cardId: string;
  };
  actions: {
    rescan: () => void;
    join: (ssid: string, passphrase: string, hidden?: boolean) => void;
    checkAgain: () => void;
    findAgain: () => void;
  };
}

// Inside the Pond's 120 s idle limit with room to spare, while someone types a password.
const KEEP_ALIVE_MS = 45_000;
const REACH_TRIES = 3;

export function usePondWifi(): UsePondWifi {
  const { t } = useTranslation();
  const router = useRouter();
  const { adoptPairing, checkHealth } = useServer();
  const [held] = useState(heldSetup);
  const [phase, setPhase] = useState<WifiPhase>(held ? { kind: 'checking' } : { kind: 'lost' });
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [failure, setFailure] = useState<UsePondWifi['data']['failure']>(null);
  const [scanFailure, setScanFailure] = useState<string | null>(null);
  const adopted = useRef(false);
  const reaching = useRef(false);

  const lose = useCallback((e: unknown) => {
    if (e instanceof SetupChannelClosed) {
      setPhase({ kind: 'lost' });
      return true;
    }
    return false;
  }, []);

  const reach = useCallback(
    async (ssid: string | null) => {
      if (reaching.current) return;
      reaching.current = true;
      setPhase((p) => (p.kind === 'unreachable' ? { ...p, checking: true } : p));
      try {
        for (let i = 0; i < REACH_TRIES; i++) {
          if (await checkHealth()) {
            void confirm();
            releaseSetup();
            router.replace((await setupNeededNow()) ? '/(onboarding)/owner-setup' : '/(tabs)');
            return;
          }
        }
        setPhase({ kind: 'unreachable', ssid, checking: false });
      } finally {
        reaching.current = false;
      }
    },
    [checkHealth, router],
  );

  const handover = useCallback(
    async (at: PondAddress, ssid: string | null) => {
      if (!held) return;
      setPhase({ kind: 'handover', ssid });
      if (!adopted.current) {
        try {
          await adoptPairing(handoverProfile(at), held.pin, held.tokens);
          adopted.current = true;
        } catch {
          void reject();
          setFailure({ ssid: ssid ?? '', message: t('pairing.failed') });
          setPhase({ kind: 'choosing', scanning: false });
          return;
        }
      }
      await reach(ssid);
    },
    [adoptPairing, held, reach, t],
  );

  const scan = useCallback(async () => {
    if (!held) return;
    setPhase({ kind: 'choosing', scanning: true });
    setScanFailure(null);
    try {
      setNetworks(wifiChoices(await held.channel.wifiScan()));
      setPhase({ kind: 'choosing', scanning: false });
    } catch (e) {
      if (lose(e)) return;
      const code = e instanceof ApiError ? e.detail : null;
      setScanFailure(code === 'unsupported' ? t(wifiErrorKey(code), { ssid: '' }) : t('bleSetup.wifi.scanFailed'));
      setPhase({ kind: 'choosing', scanning: false });
    }
  }, [held, lose, t]);

  useEffect(() => {
    if (!held) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = held.status ?? (await held.channel.status());
        if (cancelled) return;
        const at = onlineAt(status);
        if (at) {
          await handover(at, status.network.ssid);
          return;
        }
        await scan();
      } catch (e) {
        if (!cancelled && !lose(e)) await scan();
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once, on arrival: everything after is the household's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choosing = phase.kind === 'choosing';
  useEffect(() => {
    if (!held || !choosing) return;
    const timer = setInterval(() => {
      void held.channel.status().catch((e: unknown) => lose(e));
    }, KEEP_ALIVE_MS);
    return () => clearInterval(timer);
  }, [held, choosing, lose]);

  const unreachableSsid = phase.kind === 'unreachable' ? phase.ssid : undefined;
  useEffect(() => {
    if (unreachableSsid === undefined) return;
    // The phone joining the Pond's network is the moment to look again, without a tap.
    return NetInfo.addEventListener((state) => {
      if (state.isConnected && (state.type === 'wifi' || state.type === 'ethernet')) void reach(unreachableSsid);
    });
  }, [unreachableSsid, reach]);

  const join = useCallback(
    (ssid: string, passphrase: string, hidden?: boolean) => {
      if (!held || phase.kind !== 'choosing') return;
      setFailure(null);
      setPhase({ kind: 'joining', ssid });
      void (async () => {
        try {
          const joined = await held.channel.wifiJoin({ ssid, passphrase: passphrase || undefined, hidden });
          await handover(joinedAt(joined, held.status), ssid);
        } catch (e) {
          if (lose(e)) return;
          void reject();
          const code = e instanceof ApiError ? e.detail : null;
          setFailure({ ssid, message: t(wifiErrorKey(code), { ssid }) });
          setPhase({ kind: 'choosing', scanning: false });
        }
      })();
    },
    [handover, held, lose, phase.kind, t],
  );

  const findAgain = useCallback(() => {
    releaseSetup();
    router.replace('/(onboarding)/welcome');
  }, [router]);

  return {
    data: { phase, networks, failure, scanFailure, cardId: held?.cardId ?? '' },
    actions: {
      rescan: () => void scan(),
      join,
      checkAgain: () => void reach(unreachableSsid ?? null),
      findAgain,
    },
  };
}
