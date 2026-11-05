/**
 * The household as the profile header shows it: who this phone belongs to, which Pond it is
 * paired to, and how many devices, rooms, routines and members there are.
 *
 * Every one of those used to be typed into the source -- 6, 3, 4 and 2, beside a real person's
 * name and email -- so the header described a household nobody had. Each figure is now one read,
 * and they are independent: a Pond that cannot list its schedules still has a device count.
 *
 * A read that fails is reported as unknown, never as zero. Zero is a claim about somebody's home
 * ("you have no routines"), and a request that did not come back has claimed nothing.
 */
import { useCallback, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api, type PondApiClient } from '@/services/api-client';
import type { Device, DeviceSelf } from '@/services/types';
import { legacyRooms } from './use-devices';
import { useLive } from './use-live';

export interface Member {
  id: string;
  displayName: string;
}

/** `null` for any figure whose read failed. */
export interface HouseholdCounts {
  devices: number | null;
  rooms: number | null;
  routines: number | null;
  users: number | null;
}

/** Everything the header shows, as one snapshot of what the Pond answered. */
export interface Household {
  /**
   * The member this phone is attributed to; null when nobody has claimed it, or the Pond cannot
   * say; undefined when the read failed, which is not an answer.
   */
  member: Member | null | undefined;
  /** The Pond's own hostname, or null when it could not be read. */
  pondName: string | null;
  counts: HouseholdCounts;
}

export interface UseHousehold {
  data: Household;
  loading: boolean;
  actions: { refresh: () => Promise<void> };
}

/** Before the first read lands: nothing known, which is not the same as nothing there. */
const UNREAD: Household = {
  member: null,
  pondName: null,
  counts: { devices: null, rooms: null, routines: null, users: null },
};

/**
 * Rooms somebody named, from the two reads that can say: the Pond's list, or, from a Pond without
 * `/rooms` (404), the names its devices carry. Unassigned is never one, as on the Devices tab. Null
 * when the reads cannot say.
 */
export function countRooms(
  rooms: PromiseSettledResult<unknown[]>,
  devices: PromiseSettledResult<Device[]>,
): number | null {
  if (rooms.status === 'fulfilled') return rooms.value.length;
  const older = rooms.reason instanceof ApiError && rooms.reason.status === 404;
  return older && devices.status === 'fulfilled' ? legacyRooms(devices.value).rooms.length : null;
}

/** How many a list read returned, or null when the read failed. */
export function settledCount(result: PromiseSettledResult<unknown[]>): number | null {
  return result.status === 'fulfilled' ? result.value.length : null;
}

/**
 * The letter for a member's avatar, or null when the name has none to give.
 *
 * By code point, not `charAt(0)`: a name beginning outside the Basic Multilingual Plane would
 * otherwise render as half a surrogate pair.
 */
export function initialOf(displayName: string): string | null {
  const first = Array.from(displayName.trim())[0];
  return first ? first.toUpperCase() : null;
}

export function memberOf(self: DeviceSelf): Member | null {
  return self.profile ? { id: self.profile.id, displayName: self.profile.display_name } : null;
}

/**
 * A Pond that cannot answer "whose device is this", as distinct from one that tried and failed.
 *
 * A Pond from before `/devices/self` does not 404 it: the GET falls through to `/devices/{id}`,
 * which answers only DELETE and PUT, so the answer is a 405.
 */
export function isSelfUnsupported(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 405);
}

/**
 * The member this phone belongs to, or null. Never rejects.
 *
 * No name either way when it fails, but a Pond that tried and failed is not one with nothing to
 * say, and that difference should not vanish: only the unsupported case stays quiet.
 */
export async function readMember(client: Pick<PondApiClient, 'deviceSelf'> = api): Promise<Member | null | undefined> {
  try {
    return memberOf(await client.deviceSelf());
  } catch (e) {
    // A Pond from before /devices/self has answered: it cannot say, so no name.
    if (isSelfUnsupported(e)) return null;
    console.warn('[household] could not read which member this device belongs to', e instanceof ApiError ? e.status : 'network');
    return undefined;
  }
}

/** The reads the header needs, and no more of the client than that. */
type HouseholdReader = Pick<PondApiClient, 'deviceSelf' | 'systemInfo' | 'listDevices' | 'listRooms' | 'listSchedules' | 'listProfiles'>;

/**
 * Read the household in one pass. Never rejects: each read settles on its own, so one that fails
 * costs only its own figure, and it comes back as unknown rather than as zero.
 */
export async function readHousehold(client: HouseholdReader = api): Promise<Household> {
  const [member, [info, devices, schedules, profiles, rooms]] = await Promise.all([
    readMember(client),
    Promise.allSettled([
      client.systemInfo(),
      client.listDevices(),
      client.listSchedules(),
      client.listProfiles(),
      client.listRooms(),
    ]),
  ]);


  return {
    member,
    pondName: info.status === 'fulfilled' ? info.value.hostname : null,
    counts: {
      devices: settledCount(devices),
      rooms: countRooms(rooms, devices),
      routines: settledCount(schedules),
      users: settledCount(profiles),
    },
  };
}

/**
 * Fold a fresh read into what the screen already shows.
 *
 * A live screen polls, and a poll can fail. What it knew a minute ago was true a minute ago, and a
 * read that failed has said nothing, so a failure must not turn a count into a dash or take a
 * name away until the next poll. Every figure a read did return replaces the old one -- including
 * a real zero, and a real "nobody has claimed this device".
 */
export function mergeHousehold(known: Household, fresh: Household): Household {
  return {
    member: fresh.member === undefined ? known.member : fresh.member,
    pondName: fresh.pondName ?? known.pondName,
    counts: {
      devices: fresh.counts.devices ?? known.counts.devices,
      rooms: fresh.counts.rooms ?? known.counts.rooms,
      routines: fresh.counts.routines ?? known.counts.routines,
      users: fresh.counts.users ?? known.counts.users,
    },
  };
}

/** How often the profile header re-reads the household while it is in front. */
export const HOUSEHOLD_MS = 60_000;
/** Who holds this phone changes when a pairing code says so, which is rare. */
export const MEMBER_MS = 5 * 60_000;

export function useHousehold(): UseHousehold {
  const [household, setHousehold] = useState<Household>(UNREAD);
  const [loading, setLoading] = useState(true);

  // The base URL and bearer token arrive asynchronously; reading before they land calls the
  // default address unauthenticated and never retries.
  const { hydrated } = useServer();

  const load = useCallback(async () => {
    const fresh = await readHousehold();
    setHousehold((known) => mergeHousehold(known, fresh));
    setLoading(false);
  }, []);
  useLive(load, HOUSEHOLD_MS, hydrated);

  const refresh = useCallback(async () => {
    setLoading(true);
    await load();
  }, [load]);

  return { data: household, loading, actions: { refresh } };
}

/**
 * Just the member, for screens that greet without showing the rest of the household. Null until
 * the read lands and when nobody has claimed this device -- either way, no name is shown. A read
 * that fails keeps whatever name there was.
 */
export function useMember(): Member | null {
  const [member, setMember] = useState<Member | null>(null);
  const { hydrated } = useServer();

  useLive(
    async () => {
      const next = await readMember();
      if (next !== undefined) setMember(next);
    },
    MEMBER_MS,
    hydrated,
  );

  return member;
}
