/**
 * The devices this Pond knows about, grouped the way the screen shows them.
 *
 * Control goes through `set_device_state`, which the server exposes on the
 * LLM-free dispatch path. Every command is optimistic and rolls back on failure,
 * because a Matter round trip is slow enough that an unacknowledged tap reads as
 * a broken switch.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import type { Device, DeviceStatePatch, MatterStatus } from '@/services/types';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';
import i18n from '@/services/i18n';

/**
 * Read a device's power state out of `get_device_state`'s text.
 *
 * An MCP tool result is `{content, success}` — its first consumer is a language
 * model, so prose is the channel there is. pond-desktop reads the same
 * `power:` line for the same reason (`sections/Devices.tsx::powerStateOf`).
 *
 * Returns `undefined` when the device did not report power at all, which is a
 * third state and not the same as off: a contact sensor has no power line, and
 * a switch shown as "off" for one would be inventing a fact.
 */
export function parsePowerState(content: string): boolean | undefined {
  const line = content.split('\n').find((l) => /^\s*power:/.test(l));
  if (line === undefined) return undefined;
  const value = line.slice(line.indexOf(':') + 1).trim().toLowerCase();
  if (value === 'on') return true;
  if (value === 'off') return false;
  return undefined;
}

/**
 * Devices with no room of their own still have to appear somewhere.
 *
 * An id, not a name: shown through `roomLabel`. It used to be the English word, rendered raw, which
 * also merged it with a room the household had genuinely named "Unassigned".
 */
export const UNASSIGNED_ROOM = 'room.unassigned';

/** The tab shown before any room is chosen. An id, for the same reasons. */
export const ALL_ROOMS = 'room.all';

/** What a room is called on screen: the app's own buckets as copy, a household's rooms as named. */
export function roomLabel(name: string): string {
  if (name === UNASSIGNED_ROOM) return i18n.t('devices.roomUnassigned');
  if (name === ALL_ROOMS) return i18n.t('devices.roomAll');
  return name;
}

export interface DeviceRoom {
  name: string;
  devices: Device[];
}

/**
 * A bridged Matter endpoint, e.g. `matter-12345-3`.
 *
 * One node is not one device: a bridge exposes several endpoints under one node,
 * and `DELETE /devices/{id}` refuses them because removing one would mean
 * removing the node the others live on. The UI must not offer that delete.
 */
export function isBridgedEndpoint(id: string): boolean {
  return /^matter-\d+-\d+$/.test(id);
}

/**
 * Whether a device accepts a given verb.
 *
 * `capabilities` is the list the controller derived from the device's clusters.
 * An unmapped device arrives typed `matter` with an empty list — which means
 * show no controls, not show an error. Treating absent as "everything" is how a
 * contact sensor gets offered a power button.
 */
export function supports(device: Device, verb: string): boolean {
  return device.capabilities?.includes(verb) ?? false;
}

/**
 * Reachable devices first, then by name.
 *
 * A household accumulates devices that are unplugged, moved or replaced, and
 * they keep their catalogue row. Ordering by whatever the server returned puts
 * a dead bulb above a lamp someone is reaching for.
 */
export function byReachability(a: Device, b: Device): number {
  if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/** Group devices into the rooms the screen renders, in a stable order. */
export function groupByRoom(devices: Device[]): DeviceRoom[] {
  const rooms = new Map<string, Device[]>();
  for (const d of devices) {
    const name = d.room?.trim() || UNASSIGNED_ROOM;
    const existing = rooms.get(name);
    if (existing) existing.push(d);
    else rooms.set(name, [d]);
  }
  return [...rooms.entries()]
    .map(([name, list]) => ({ name, devices: [...list].sort(byReachability) }))
    .sort((a, b) => {
      // Unassigned sits last; it is a fallback, not a room anyone named.
      if (a.name === UNASSIGNED_ROOM) return 1;
      if (b.name === UNASSIGNED_ROOM) return -1;
      return a.name.localeCompare(b.name);
    });
}

export interface UseDevices {
  data: {
    devices: Device[];
    rooms: DeviceRoom[];
    /**
     * Room names for the filter tabs, derived rather than hardcoded. Empty
     * when there is only one room: a filter with a single option is chrome.
     */
    roomTabs: string[];
    /** How many devices the Pond can currently reach. */
    onlineCount: number;
    /** Power state by device id. Absent means the device did not report one. */
    powerById: Record<string, boolean>;
    matter: MatterStatus | null;
  };
  loading: boolean;
  error: string | null;
  actions: {
    refresh: () => Promise<void>;
    setState: (device: Device, patch: DeviceStatePatch) => Promise<void>;
    commission: (code: string, name?: string) => Promise<string | null>;
    remove: (device: Device) => Promise<void>;
  };
}

/**
 * How often the device list and power states are re-read while a devices screen is in front.
 *
 * Each read is one request for the list and one per switchable device, so this is the most
 * expensive poll in the app and it runs slower than Now Playing for that reason.
 */
export const DEVICES_MS = 15_000;

/**
 * Fold a poll's power readings in without undoing anything changed after that poll began.
 *
 * A poll is slower than a tap. One that read the lamp as off just before it was switched on would
 * land afterwards and switch it back off on screen, and if it landed after the switch's own
 * read-back it would stay wrong until the next poll. So a device changed at or after
 * `pollStartedAt` keeps what it shows; every other device takes the poll, including a device the
 * poll no longer reports, which becomes unknown.
 */
export function mergePower(
  current: Record<string, boolean>,
  fresh: Record<string, boolean>,
  changedAt: Record<string, number>,
  pollStartedAt: number,
): Record<string, boolean> {
  const next = { ...fresh };
  for (const [id, at] of Object.entries(changedAt)) {
    if (at >= pollStartedAt && id in current) next[id] = current[id];
  }
  return next;
}

/**
 * Whether a poll's device list may be shown. Not if the list was changed here -- a removal or a
 * commission -- at or after the poll began, which would put a deleted device back.
 */
export function listPollStillCurrent(pollStartedAt: number, listChangedAt: number): boolean {
  return pollStartedAt > listChangedAt;
}

/**
 * Whether a poll's power readings may be applied. Not if a poll that began later has already
 * applied its own: reads are not awaited by the poll loop, so a slow one can land after a
 * faster, newer one and would put an older state back on screen.
 */
export function powerPollStillCurrent(pollStartedAt: number, newestAppliedAt: number): boolean {
  return pollStartedAt >= newestAppliedAt;
}

export function useDevices(): UseDevices {
  const [devices, setDevices] = useState<Device[]>([]);
  const [powerById, setPowerById] = useState<Record<string, boolean>>({});
  const [matter, setMatter] = useState<MatterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // When this screen last changed something itself, so a poll that began earlier cannot undo it.
  const powerChangedAt = useRef<Record<string, number>>({});
  const listChangedAt = useRef(0);
  const powerAppliedAt = useRef(0);
  // Whether a read has ever succeeded. Before that a failure is the screen's news; after it, a
  // failed poll keeps the last list rather than replacing it with an error.
  const loaded = useRef(false);

  /**
   * Read power state for the devices that have it.
   *
   * One dispatch call per device, in parallel, and a device that fails is simply
   * left unknown rather than failing the grid — a single unreachable bulb should
   * not blank the screen.
   */
  const readPower = useCallback(async (list: Device[], startedAt: number) => {
    const readings = await Promise.all(
      list
        .filter((d) => supports(d, 'power'))
        .map(async (d) => {
          try {
            const result = await api.getDeviceState(d.id);
            return [d.id, parsePowerState(result.content)] as const;
          } catch {
            return [d.id, undefined] as const;
          }
        }),
    );
    const fresh = Object.fromEntries(
      readings.filter((r): r is readonly [string, boolean] => r[1] !== undefined),
    );
    if (!powerPollStillCurrent(startedAt, powerAppliedAt.current)) return;
    powerAppliedAt.current = startedAt;
    setPowerById((current) => mergePower(current, fresh, powerChangedAt.current, startedAt));
  }, []);

  // The base URL and bearer token arrive asynchronously; fetching before they
  // land calls the default address unauthenticated and never retries.
  const { hydrated } = useServer();

  /**
   * One read of the list, the power states and the controller.
   *
   * `loud` is a read somebody asked for: it shows a spinner and reports a failure. A poll is
   * quiet: it keeps what is on screen through a failure, because a Pond that is briefly
   * unreachable has said nothing about the devices, and the connection banner already says
   * whether it can be reached.
   */
  const load = useCallback(
    async (loud: boolean) => {
      const startedAt = Date.now();
      if (loud) {
        setLoading(true);
        setError(null);
      }
      try {
        const list = await api.listDevices();
        if (listPollStillCurrent(startedAt, listChangedAt.current)) setDevices(list);
        loaded.current = true;
        setError(null);
        void readPower(list, startedAt);
      } catch (e) {
        if (loud || !loaded.current) setError(describeDeviceError(e));
        else console.warn('[devices] refresh failed; showing the last list', e instanceof ApiError ? e.status : 'network');
      } finally {
        setLoading(false);
      }
      // Matter status is advisory: a Pond with the controller unreachable still
      // lists and controls whatever is already registered, so a failure here must
      // not take the screen down with it.
      try {
        setMatter(await api.matterStatus());
      } catch {
        setMatter(null);
      }
    },
    [readPower],
  );
  useLive(() => load(false), DEVICES_MS, hydrated);

  const refresh = useCallback(() => load(true), [load]);

  /**
   * Apply a patch optimistically, then reconcile against the server.
   *
   * The reconcile matters as much as the rollback: the controller reads a device
   * back after applying, because devices quantise and clamp — asking for 37%
   * brightness may land on 40. Rendering the request rather than the result is a
   * bug this protocol has already had once.
   */
  const setState = useCallback(
    async (device: Device, patch: DeviceStatePatch) => {
      const previous = powerById;
      powerChangedAt.current[device.id] = Date.now();
      if (patch.power !== undefined) {
        setPowerById((current) => ({ ...current, [device.id]: patch.power as boolean }));
      }
      try {
        await api.setDeviceState(device.id, patch);
        // Read back rather than trusting the request. The controller reports
        // what the device actually did, and devices quantise and clamp — asking
        // for 37% may land on 40. Rendering the ask instead of the outcome is a
        // bug this protocol has already had.
        const result = await api.getDeviceState(device.id);
        const actual = parsePowerState(result.content);
        if (actual !== undefined) {
          // The read-back is the newest thing known about this device; a poll already in
          // flight began before it and must not overwrite it.
          powerChangedAt.current[device.id] = Date.now();
          setPowerById((current) => ({ ...current, [device.id]: actual }));
        }
      } catch (e) {
        setPowerById(previous);
        setError(describeDeviceError(e));
      }
    },
    [powerById],
  );

  /** Returns the new device's id, or null when commissioning failed. */
  const commission = useCallback(async (code: string, name?: string) => {
    setError(null);
    try {
      const created = await api.commissionDevice({ code, name });
      const list = await api.listDevices();
      // After the read, so a poll that began before it cannot replace this list with an older one.
      listChangedAt.current = Date.now();
      setDevices(list);
      return created.id;
    } catch (e) {
      setError(describeCommissionError(e));
      return null;
    }
  }, []);

  const remove = useCallback(
    async (device: Device) => {
      const previous = devices;
      listChangedAt.current = Date.now();
      setDevices((current) => current.filter((d) => d.id !== device.id));
      try {
        await api.deleteDevice(device.id);
      } catch (e) {
        setDevices(previous);
        setError(describeDeviceError(e));
      } finally {
        // Again once the server has answered: a poll that began while the delete was still out
        // read a list the server had not yet changed.
        listChangedAt.current = Date.now();
      }
    },
    [devices],
  );

  const rooms = useMemo(() => groupByRoom(devices), [devices]);

  return {
    data: {
      devices,
      rooms,
      // One room means one destination, and a filter that cannot change what
      // is shown is chrome. The screen renders no tabs at all in that case.
      roomTabs: rooms.length > 1 ? [ALL_ROOMS, ...rooms.map((r) => r.name)] : [],
      onlineCount: devices.filter((d) => d.is_online).length,
      powerById,
      matter,
    },
    loading,
    error,
    actions: { refresh, setState, commission, remove },
  };
}

function describeDeviceError(e: unknown): string | null {
  if (e instanceof ApiError) {
    if (e.status === 404) return i18n.t('errors.deviceGone');
    if (e.status === 409) return i18n.t('errors.bridgedEndpoint');
  }
  return describeApiError(e);
}

/**
 * Commissioning failures are a closed set server-side, and each one calls for a
 * different action — so they are explained rather than reported.
 *
 * The message never echoes the setup code. It is a credential, redacted on both
 * sides of the protocol, and putting it in UI copy would undo that.
 */
export function describeCommissionError(e: unknown): string | null {
  // As `describeApiError`: an unreachable pond is the banner's to report.
  if (!(e instanceof ApiError)) return null;
  switch (e.status) {
    case 503:
      return i18n.t('devices.matterStartingRetry');
    case 502:
      return i18n.t('devices.matterRefused');
    case 400:
      return i18n.t('devices.setupCodeRejected');
    default:
      return describeApiError(e);
  }
}
