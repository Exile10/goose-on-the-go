// New Ponds near the phone, however each was heard: over BLE, on the network, or both.

/** Every setup advertisement's service UUID starts so; its last two bytes are the card's id. */
export const SETUP_ADVERT_PREFIX = '185b51bd-e038-4b6c-99b0-4e2379dd';

/** The service UUID a Pond with this card id advertises. */
export function setupAdvertUuid(cardId: string): string {
  return SETUP_ADVERT_PREFIX + cardId;
}

/** The card's id from an advertised setup service UUID, or null for any other UUID. */
export function cardIdFromService(uuid: string): string | null {
  const lower = uuid.toLowerCase();
  if (!lower.startsWith(SETUP_ADVERT_PREFIX)) return null;
  const id = lower.slice(SETUP_ADVERT_PREFIX.length);
  return /^[0-9a-f]{4}$/.test(id) ? id : null;
}

/** The card's id from an advertised local name, `Pond <4 lowercase hex>`, or null for anything else. */
export function cardIdFromName(name: string | null | undefined): string | null {
  const match = /^Pond ([0-9a-f]{4})$/.exec(name ?? '');
  return match ? match[1] : null;
}

/**
 * A sighting's card id comes from its service UUID, which is in the advertisement itself; the name
 * rides in a scan response that may never arrive. A Pond name naming another card drops the sighting.
 */
export function cardIdOf(sighting: { services: readonly string[]; name: string | null }): string | null {
  const ids = new Set(sighting.services.map(cardIdFromService).filter((id): id is string => id !== null));
  if (ids.size !== 1) return null;
  const [id] = ids;
  const named = cardIdFromName(sighting.name);
  return named === null || named === id ? id : null;
}

export interface NearbyPond {
  /** The card's four hex digits: what the household can match against the card in their hand. */
  id: string;
  /** The BLE advertiser to connect to, when the Pond was heard over Bluetooth. */
  peripheral: string | null;
  rssi: number | null;
  /** The HTTPS origin and pin, when the Pond also advertises `setup=1` on this network. */
  url: string | null;
  pin: string | null;
  /** The Pond's host name, known only from the network. */
  hostname: string | null;
  /** When it was last heard, in ms. */
  seenAt: number;
  /** True when the Pond is already set up on the network and also heard over BLE. */
  claimed?: boolean;
}

export interface BleSightingLike {
  peripheral: string;
  /** The advertised setup service UUIDs. */
  services: readonly string[];
  name: string | null;
  rssi: number;
}

export interface NetworkPondLike {
  url: string;
  pin?: string;
  setupId?: string | null;
  unclaimed: boolean;
  hostname?: string;
}

/** The card ids of Ponds this network already lists as set up. */
function setUpOnNetwork(network: readonly NetworkPondLike[]): Set<string> {
  return new Set(network.flatMap((p) => (!p.unclaimed && p.setupId ? [p.setupId.toLowerCase()] : [])));
}

/**
 * One row per card id. A Pond on the network as well is one Pond, and the network path is preferred
 * for it later: HTTPS needs no Wi-Fi step. A set-up Pond whose pairing lock holds advertises over
 * Bluetooth too; when this network already lists it as set up it is joined from that list, and is
 * no row here, so it is never offered as a new Pond.
 */
export function mergeNearby(
  ble: ReadonlyMap<string, BleSightingLike & { seenAt: number }>,
  network: readonly NetworkPondLike[],
): NearbyPond[] {
  const byId = new Map<string, NearbyPond>();
  const joinable = setUpOnNetwork(network);
  for (const s of ble.values()) {
    const id = cardIdOf(s);
    if (!id || joinable.has(id)) continue;
    const held = byId.get(id);
    // Two advertisers with one card id: keep the louder, which is the nearer.
    if (held && (held.rssi ?? -999) >= s.rssi) continue;
    byId.set(id, { id, peripheral: s.peripheral, rssi: s.rssi, url: null, pin: null, hostname: null, seenAt: s.seenAt });
  }
  for (const p of network) {
    const id = p.setupId?.toLowerCase();
    if (!p.unclaimed || !id || !/^[0-9a-f]{4}$/.test(id)) continue;
    const held = byId.get(id);
    byId.set(id, {
      id,
      peripheral: held?.peripheral ?? null,
      rssi: held?.rssi ?? null,
      url: p.url,
      pin: p.pin ?? null,
      hostname: p.hostname ?? null,
      seenAt: held?.seenAt ?? 0,
    });
  }
  // Strongest signal first; network-only Ponds after, by id, so the list does not jump about.
  return [...byId.values()].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999) || a.id.localeCompare(b.id));
}

/** Finds the loudest matching BLE sighting for a set-up Pond's `setupId`. */
export function bleTargetFor(
  setupId: string | null | undefined,
  ble: ReadonlyMap<string, BleSightingLike & { seenAt: number }>,
  fallback?: { url?: string; pin?: string; hostname?: string },
): NearbyPond | null {
  const target = setupId?.toLowerCase();
  if (!target || !/^[0-9a-f]{4}$/.test(target)) return null;
  let best: (BleSightingLike & { seenAt: number }) | null = null;
  for (const s of ble.values()) {
    if (cardIdOf(s) !== target) continue;
    if (!best || s.rssi > best.rssi) best = s;
  }
  if (!best) return null;
  return {
    id: target,
    peripheral: best.peripheral,
    rssi: best.rssi,
    url: fallback?.url ?? null,
    pin: fallback?.pin ?? null,
    hostname: fallback?.hostname ?? null,
    seenAt: best.seenAt,
    claimed: true,
  };
}

/**
 * The list with the picked Pond kept in it: connecting stops the scan, so a picked Pond is soon
 * pruned, and its claim must not go with it.
 */
export function keepPicked(fresh: NearbyPond[], picked: NearbyPond | null): NearbyPond[] {
  if (!picked || fresh.some((p) => p.id === picked.id)) return fresh;
  return [picked, ...fresh];
}

/** Forget advertisers not heard for a while: a Pond that has joined Wi-Fi stops advertising. */
export function pruneSightings<T extends { seenAt: number }>(sightings: Map<string, T>, now: number, maxAgeMs = 15_000): boolean {
  let changed = false;
  for (const [key, s] of sightings) {
    if (now - s.seenAt > maxAgeMs) {
      sightings.delete(key);
      changed = true;
    }
  }
  return changed;
}

/** Bars for a list row, from RSSI: a rough guide to which Pond is the one beside you. */
export function signalBars(rssi: number | null): 0 | 1 | 2 | 3 {
  if (rssi === null) return 0;
  if (rssi >= -60) return 3;
  if (rssi >= -75) return 2;
  return 1;
}
