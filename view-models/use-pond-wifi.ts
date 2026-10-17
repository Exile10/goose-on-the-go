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
import { connectPond, findPondById } from '@/services/ble';
import { devicePassword } from '@/services/cpace';
import { confirm, reject } from '@/services/haptics';
import { getInstallId } from '@/services/install-id';
import { SetupChannelClosed, type WifiNetwork } from '@/services/setup-channel/session';
import { heldSetup, holdSetup, releaseSetup, type HeldSetup } from '@/services/setup-session';
import { bleClaim } from './pond-claim';
import { setupNeededNow } from './use-setup-gate';

export type WifiPhase =
  | { kind: 'checking' }
  | { kind: 'choosing'; scanning: boolean }
  | { kind: 'joining'; ssid: string }
  | { kind: 'handover'; ssid: string | null }
  | { kind: 'unreachable'; ssid: string | null; checking: boolean }
  /** Finding the Pond again and resuming on the claim's own refresh token, with no code. */
  | { kind: 'reconnecting' }
  /** The Bluetooth session ended before the Pond had an address; `note` says a resume did not work. */
  | { kind: 'lost'; note?: string };

export interface UsePondWifi {
  data: {
    phase: WifiPhase;
    networks: WifiNetwork[];
    /** Why the last join failed, in the Pond's own terms, for the network it was for. */
    failure: { ssid: string; message: string } | null;
    /** Why the Pond could not list networks, so an empty list is not mistaken for none in range. */
    scanFailure: string | null;
    cardId: string;
    /** This phone still holds the claim's tokens, so a dropped session can resume without a code. */
    canResume: boolean;
  };
  actions: {
    rescan: () => void;
    /** Find the Pond again over Bluetooth and resume as the paired device. */
    reconnect: () => void;
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
  const [held, setHeld] = useState(heldSetup);
  // A resume replaces the held session; callbacks read the current one rather than the first.
  const heldRef = useRef(held);
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
      const current = heldRef.current;
      if (!current) return;
      setPhase({ kind: 'handover', ssid });
      if (!adopted.current) {
        try {
          await adoptPairing(handoverProfile(at), current.pin, current.tokens);
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
    [adoptPairing, reach, t],
  );

  const scan = useCallback(async () => {
    const current = heldRef.current;
    if (!current) return;
    setPhase({ kind: 'choosing', scanning: true });
    setScanFailure(null);
    try {
      setNetworks(wifiChoices(await current.channel.wifiScan()));
      setPhase({ kind: 'choosing', scanning: false });
    } catch (e) {
      if (lose(e)) return;
      const code = e instanceof ApiError ? e.detail : null;
      setScanFailure(code === 'unsupported' ? t(wifiErrorKey(code), { ssid: '' }) : t('bleSetup.wifi.scanFailed'));
      setPhase({ kind: 'choosing', scanning: false });
    }
  }, [lose, t]);

  /** What arriving does: a Pond already online goes straight to the handover, any other lists its networks. */
  const begin = useCallback(
    async (setup: HeldSetup) => {
      try {
        const status = setup.status ?? (await setup.channel.status());
        const at = onlineAt(status);
        if (at) {
          await handover(at, status.network.ssid);
          return;
        }
        await scan();
      } catch (e) {
        if (!lose(e)) await scan();
      }
    },
    [handover, lose, scan],
  );

  useEffect(() => {
    // On a microtask, as useLive starts its reads, so arriving never sets state inside the effect itself.
    if (held) void Promise.resolve().then(() => begin(held));
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
      const current = heldRef.current;
      if (!current || phase.kind !== 'choosing') return;
      setFailure(null);
      setPhase({ kind: 'joining', ssid });
      void (async () => {
        try {
          const joined = await current.channel.wifiJoin({ ssid, passphrase: passphrase || undefined, hidden });
          await handover(joinedAt(joined, current.status), ssid);
        } catch (e) {
          if (lose(e)) return;
          void reject();
          const code = e instanceof ApiError ? e.detail : null;
          setFailure({ ssid, message: t(wifiErrorKey(code), { ssid }) });
          setPhase({ kind: 'choosing', scanning: false });
        }
      })();
    },
    [handover, lose, phase.kind, t],
  );

  const findAgain = useCallback(() => {
    releaseSetup();
    router.replace('/(onboarding)/welcome');
  }, [router]);

  // The claim's tokens are still held, so the Pond can be found again and resumed without a code
  // (pond-setup-channel.md, "Resuming as a paired device"). Anything that fails sends the household
  // back to Find your Pond for a spoken code.
  const reconnect = useCallback(() => {
    const was = heldRef.current;
    const refresh = was?.tokens.refresh_token;
    if (!was || !refresh) {
      findAgain();
      return;
    }
    setPhase({ kind: 'reconnecting' });
    void (async () => {
      try {
        const peripheral = await findPondById(was.cardId);
        if (!peripheral) throw new Error('not heard');
        const pond = { id: was.cardId, peripheral, rssi: null, url: null, pin: null, hostname: null, seenAt: Date.now() };
        const resp = await bleClaim(pond, { connect: connectPond, hold: holdSetup }).claim({
          credential: 'device',
          code: devicePassword(refresh),
          clientId: await getInstallId(),
          deviceName: '',
        });
        const next = heldSetup();
        if (!resp.accepted || !next || next === was || next.pin !== was.pin) throw new Error('not resumed');
        heldRef.current = next;
        setHeld(next);
        void confirm();
        await begin(next);
      } catch {
        void reject();
        setPhase({ kind: 'lost', note: t('bleSetup.wifi.reconnectFailed') });
      }
    })();
  }, [begin, findAgain, t]);

  return {
    data: { phase, networks, failure, scanFailure, cardId: held?.cardId ?? '', canResume: !!held?.tokens.refresh_token },
    actions: {
      rescan: () => void scan(),
      reconnect,
      join,
      checkAgain: () => void reach(unreachableSsid ?? null),
      findAgain,
    },
  };
}
