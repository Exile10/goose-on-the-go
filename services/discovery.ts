/**
 * Finds Ponds on the local network over mDNS.
 *
 * pond-server already advertises `_pond._tcp.local.` — its own log says "phones
 * on the same LAN can now discover this hub" — and until now nothing consumed
 * it. Typing an address by hand was the only way in.
 *
 * Why this matters more than it looks: Android's resolver does **no mDNS**, so
 * the `<hostname>.local` in a pairing QR cannot be reached there at all. But
 * NsdManager resolves the service itself and hands back numeric addresses, so
 * discovery returns something the phone can actually connect to. It sidesteps
 * the name-resolution problem rather than working around it.
 */

import Zeroconf, { type Service } from 'react-native-zeroconf';

/** The service pond-server registers. */
const SERVICE_TYPE = 'pond';
const PROTOCOL = 'tcp';
const DOMAIN = 'local.';

/** A Pond found on the network, reduced to what the wizard needs. */
export interface DiscoveredPond {
  /** Stable identity: the address and port actually dialled. */
  id: string;
  /** The advertised instance label, e.g. "Pond Hub @ nano". */
  name: string;
  /** A numeric address, never a `.local` name — see the note above. */
  address: string;
  port: number;
  /** Base URL to hand to the api client. */
  url: string;
  /** Server version from the TXT record, when it published one. */
  version?: string;
}

/** IPv4 only. An IPv6 literal needs bracketing in a URL and buys nothing here. */
function firstIPv4(addresses: string[] | undefined): string | null {
  return addresses?.find((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a)) ?? null;
}

/**
 * Reduce a resolved service to a Pond, or null when it cannot be dialled.
 *
 * A service that resolved without a numeric address is dropped rather than
 * shown: its `host` would be a `.local` name, which is precisely what this
 * feature exists to avoid handing to the user.
 */
export function toPond(service: Service): DiscoveredPond | null {
  const address = firstIPv4(service.addresses);
  const port = service.port;
  if (!address || !port) return null;

  const version = typeof service.txt?.v === 'string' ? service.txt.v : undefined;
  return {
    id: `${address}:${port}`,
    name: service.name?.trim() || 'Pond',
    address,
    port,
    url: `http://${address}:${port}`,
    version,
  };
}

/**
 * Collapse duplicate advertisements.
 *
 * One hub can appear several times: mDNS records outlive the process that
 * registered them, so restarting a server leaves ghosts advertising the same
 * address until their TTL expires. Browsing this network turned up six
 * instances for two actual hubs. Keying on address and port means a restart
 * replaces its own entry instead of adding another.
 */
export function dedupe(ponds: DiscoveredPond[]): DiscoveredPond[] {
  const byId = new Map<string, DiscoveredPond>();
  for (const pond of ponds) byId.set(pond.id, pond);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface DiscoveryHandle {
  stop: () => void;
}

/**
 * Start browsing. Calls `onFound` with the full deduplicated list each time it
 * changes, and `onError` for a failure the user should hear about.
 *
 * The returned handle must be stopped: a live browse holds a multicast lock on
 * Android, which costs battery for as long as it is held.
 */
export function startDiscovery(
  onFound: (ponds: DiscoveredPond[]) => void,
  onError: (message: string) => void,
): DiscoveryHandle {
  const zeroconf = new Zeroconf();
  const found: DiscoveredPond[] = [];

  zeroconf.on('resolved', (service: Service) => {
    const pond = toPond(service);
    if (!pond) return;
    found.push(pond);
    onFound(dedupe(found));
  });

  zeroconf.on('error', (e: Error) => {
    onError(e?.message ?? 'Could not search the network.');
  });

  try {
    zeroconf.scan(SERVICE_TYPE, PROTOCOL, DOMAIN);
  } catch (e) {
    onError(e instanceof Error ? e.message : 'Could not start searching.');
  }

  return {
    stop: () => {
      try {
        zeroconf.stop();
      } finally {
        zeroconf.removeDeviceListeners();
      }
    },
  };
}
