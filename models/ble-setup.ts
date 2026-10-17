// What setting up a new Pond over the setup channel decides, kept out of the screens so it is tested.

import type { ConnectionProfile } from './connection';
import type { TranslationKey } from '@/services/i18n';
import type { ChannelStatus, WifiJoined, WifiNetwork } from '@/services/setup-channel/session';

/** Where the Pond answers HTTPS once it has a network. */
export interface PondAddress {
  address: string;
  httpsPort: number;
  hostname: string;
}

/** The Pond is already on a network (Ethernet, or Wi-Fi it knew), so there is no Wi-Fi to choose. */
export function onlineAt(status: ChannelStatus): PondAddress | null {
  const { state, ipv4 } = status.network;
  if (state !== 'connected' || !ipv4 || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ipv4)) return null;
  if (status.httpsPort < 1 || status.httpsPort > 65535) return null;
  return { address: ipv4, httpsPort: status.httpsPort, hostname: status.hostname };
}

export function joinedAt(joined: WifiJoined, status: ChannelStatus | null): PondAddress {
  return { address: joined.address, httpsPort: joined.httpsPort, hostname: joined.hostname || status?.hostname || '' };
}

/** As discovery normalises a host name, so the saved profile's host finds this Pond again over mDNS. */
export function normaliseHostname(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, '').replace(/\.local$/, '');
}

/**
 * The pairing to keep: dialled at the numeric address, and found again by host name when the lease
 * changes. A Pond that sent no usable name keeps its address as the host, as a typed one does.
 */
export function handoverProfile(at: PondAddress): ConnectionProfile {
  const host = normaliseHostname(at.hostname);
  return {
    version: 2,
    host: /^[a-z0-9-]{1,63}$/.test(host) ? host : at.address,
    port: at.httpsPort,
    localUrls: [`https://${at.address}:${at.httpsPort}`],
    remoteAccess: { mode: 'local' },
  };
}

/** One row per network name, strongest kept, in the Pond's order: it already puts the strongest first. */
export function wifiChoices(networks: readonly WifiNetwork[]): WifiNetwork[] {
  const best = new Map<string, WifiNetwork>();
  for (const n of networks) {
    const held = best.get(n.ssid);
    if (!held || n.signal > held.signal) best.set(n.ssid, held ? { ...n, known: n.known || held.known } : n);
  }
  return [...best.values()].sort((a, b) => Number(b.known) - Number(a.known) || b.signal - a.signal);
}

export function needsPassphrase(network: Pick<WifiNetwork, 'security' | 'known'>): boolean {
  return network.security !== 'open' && !network.known;
}

/** WPA's shortest passphrase is 8; WEP keys are 5 or 13 characters. Anything else cannot work. */
export function passphraseUsable(security: WifiNetwork['security'], passphrase: string): boolean {
  if (security === 'open') return true;
  if (security === 'wep') return [5, 10, 13, 26].includes(passphrase.length);
  return passphrase.length >= 8 && passphrase.length <= 63;
}

/** The Pond's `wifi_join` refusals, each with its own sentence. */
export function wifiErrorKey(code: string | null | undefined): TranslationKey {
  switch (code) {
    case 'wrong_password':
      return 'bleSetup.wifi.errors.wrongPassword';
    case 'not_found':
      return 'bleSetup.wifi.errors.notFound';
    case 'no_address':
      return 'bleSetup.wifi.errors.noAddress';
    case 'timeout':
      return 'bleSetup.wifi.errors.timeout';
    case 'not_permitted':
      return 'bleSetup.wifi.errors.notPermitted';
    case 'unsupported':
      return 'bleSetup.wifi.errors.unsupported';
    case 'busy':
      return 'bleSetup.wifi.errors.busy';
    default:
      return 'bleSetup.wifi.errors.other';
  }
}

export function securityKey(security: WifiNetwork['security']): TranslationKey {
  switch (security) {
    case 'open':
      return 'bleSetup.wifi.security.open';
    case 'wep':
      return 'bleSetup.wifi.security.wep';
    case 'enterprise':
      return 'bleSetup.wifi.security.enterprise';
    default:
      return 'bleSetup.wifi.security.secured';
  }
}

/** What the phone is called on the Pond until someone changes it: its own name, else its model. */
export function defaultPhoneName(deviceName: string | null | undefined, modelName: string | null | undefined): string {
  const name = deviceName?.trim() || modelName?.trim() || '';
  return name.slice(0, 64);
}
