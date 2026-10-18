/**
 * Claiming a new Pond, by whichever way it was heard. Over the network it is the HTTPS exchange the
 * pairing wizard runs; over Bluetooth it is the same exchange on the setup channel, and the channel
 * is then handed on for Wi-Fi. Both prove the Pond's pin with the code, so neither asks for the
 * fingerprint pick.
 */

import type { HandshakeResponse } from '@/services/api-client';
import type { PakeCredential } from '@/services/cpace';
import type { ConnectionProfile } from '@/models/connection';
import type { NearbyPond } from '@/models/nearby-pond';
import type { HeldSetup } from '@/services/setup-session';
import { BleUnreachableError, WrongPondError } from '@/services/ble';
import { SetupChannel, type SetupLink } from '@/services/setup-channel/session';

export interface ClaimInput {
  credential: PakeCredential;
  code: string;
  clientId: string;
  deviceName: string;
}

export interface ClaimDriver {
  readonly transport: 'ble' | 'network';
  /** Over Bluetooth, whether the Pond is already someone's (one that lost its network still advertises), and its pin. */
  greet(): Promise<{ claimed: boolean; pin: string } | null>;
  /** Whether this Pond can say a pairing code aloud. */
  canSpeak(): Promise<boolean>;
  speak(): Promise<void>;
  /** Accepted means the pairing is kept (network) or held for Wi-Fi (Bluetooth). */
  claim(input: ClaimInput): Promise<HandshakeResponse>;
  close(): void;
}

export function bleClaim(
  pond: NearbyPond,
  deps: { connect: (peripheral: string) => Promise<SetupLink>; hold: (setup: HeldSetup) => void },
  random?: (count: number) => Uint8Array,
): ClaimDriver {
  let channel: SetupChannel | null = null;

  const open = async (): Promise<SetupChannel> => {
    if (channel && !channel.isClosed) return channel;
    if (!pond.peripheral) throw new BleUnreachableError(null);
    let link: SetupLink;
    try {
      link = await deps.connect(pond.peripheral);
    } catch (e) {
      throw new BleUnreachableError(e);
    }
    const next = new SetupChannel(link, random);
    const hello = await next.greet();
    // The name was only a claim made over the air; hello is the Pond's own answer, after connecting.
    if (hello.pondId && hello.pondId !== pond.id) {
      await next.close();
      throw new WrongPondError(pond.id, hello.pondId);
    }
    channel = next;
    return next;
  };

  return {
    transport: 'ble',
    async greet() {
      const hello = (await open()).hello;
      return { claimed: hello?.claimed ?? false, pin: hello?.pin ?? '' };
    },
    async canSpeak() {
      return (await open()).hello?.capabilities.includes('spoken_code') ?? false;
    },
    async speak() {
      await (await open()).spokenCode();
    },
    async claim(input) {
      const session = await open();
      const resp = await session.exchange(input);
      if (!resp.accepted) return resp;
      const status = await session.status().catch(() => null);
      deps.hold({ channel: session, cardId: pond.id, pin: session.hello?.pin ?? '', tokens: resp, status });
      // The channel belongs to the Wi-Fi step now; closing this driver must not close it.
      channel = null;
      return resp;
    },
    close() {
      void channel?.close();
      channel = null;
    },
  };
}

export function networkClaim(
  pond: NearbyPond,
  deps: {
    stage: (profile: ConnectionProfile, pin: string) => Promise<void>;
    pair: (opts: { clientId: string; pairingCode: string; credential?: PakeCredential; deviceName?: string }) => Promise<HandshakeResponse>;
    requestSpokenCode: () => Promise<unknown>;
    cancel: () => Promise<void>;
  },
): ClaimDriver {
  let staged = false;
  const stage = async () => {
    if (staged) return;
    if (!pond.url || !pond.pin) throw new Error('not on this network');
    const url = new URL(pond.url);
    await deps.stage({ version: 2, host: url.hostname, port: Number(url.port) || 443, localUrls: [pond.url] }, pond.pin);
    staged = true;
  };
  return {
    transport: 'network',
    async greet() {
      return null;
    },
    async canSpeak() {
      return true;
    },
    async speak() {
      await stage();
      await deps.requestSpokenCode();
    },
    async claim(input) {
      await stage();
      const resp = await deps.pair({ clientId: input.clientId, pairingCode: input.code, credential: input.credential, deviceName: input.deviceName });
      // A kept pairing is no longer staged, so there is nothing to cancel.
      if (resp.accepted) staged = false;
      return resp;
    },
    close() {
      if (staged) void deps.cancel();
      staged = false;
    },
  };
}

/** The network when the Pond is on it, since HTTPS then needs no Wi-Fi step; otherwise Bluetooth. */
export function prefersNetwork(pond: NearbyPond): boolean {
  return Boolean(pond.url && pond.pin);
}
