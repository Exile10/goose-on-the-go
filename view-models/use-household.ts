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
import { useCallback, useEffect, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api, type PondApiClient } from '@/services/api-client';
import type { Device, DeviceSelf } from '@/services/types';
import { UNASSIGNED_ROOM, groupByRoom } from './use-devices';

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
  /** The member this phone is attributed to, or null when nobody has claimed it. */
  member: Member | null;
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
 * Rooms somebody named. Built on `groupByRoom` rather than re-derived, so this header and the
 * Devices tab cannot disagree about how many rooms a household has.
 */
export function countRooms(devices: Device[]): number {
  return groupByRoom(devices).filter((room) => room.name !== UNASSIGNED_ROOM).length;
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

/** The reads the header needs, and no more of the client than that. */
type HouseholdReader = Pick<PondApiClient, 'deviceSelf' | 'systemInfo' | 'listDevices' | 'listSchedules' | 'listProfiles'>;

/**
 * Read the household in one pass. Never rejects: each read settles on its own, so one that fails
 * costs only its own figure, and it comes back as unknown rather than as zero.
 */
export async function readHousehold(client: HouseholdReader = api): Promise<Household> {
  const [self, info, devices, schedules, profiles] = await Promise.allSettled([
    client.deviceSelf(),
    client.systemInfo(),
    client.listDevices(),
    client.listSchedules(),
    client.listProfiles(),
  ]);

  let member: Member | null = null;
  if (self.status === 'fulfilled') {
    member = memberOf(self.value);
  } else if (!isSelfUnsupported(self.reason)) {
    // No name either way, but a Pond that tried and failed is not one with nothing to say, and
    // that difference should not vanish.
    console.warn('[household] could not read which member this device belongs to', self.reason instanceof ApiError ? self.reason.status : 'network');
  }

  return {
    member,
    pondName: info.status === 'fulfilled' ? info.value.hostname : null,
    counts: {
      devices: settledCount(devices),
      rooms: devices.status === 'fulfilled' ? countRooms(devices.value) : null,
      routines: settledCount(schedules),
      users: settledCount(profiles),
    },
  };
}

export function useHousehold(): UseHousehold {
  const [household, setHousehold] = useState<Household>(UNREAD);
  const [loading, setLoading] = useState(true);

  // The base URL and bearer token arrive asynchronously; reading before they land calls the
  // default address unauthenticated and never retries.
  const { hydrated } = useServer();

  // State is set in the promise's callback, never synchronously in the effect, and not at all
  // once the screen has gone: a read that lands after unmount has nowhere to put its answer.
  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    void readHousehold().then((next) => {
      if (!live) return;
      setHousehold(next);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [hydrated]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setHousehold(await readHousehold());
    setLoading(false);
  }, []);

  return { data: household, loading, actions: { refresh } };
}
