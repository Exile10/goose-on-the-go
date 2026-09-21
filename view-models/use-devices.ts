/**
 * The devices this Pond knows about, grouped the way the screen shows them.
 *
 * Control goes through `set_device_state`, which the server exposes on the
 * LLM-free dispatch path. Every command is optimistic and rolls back on failure,
 * because a Matter round trip is slow enough that an unacknowledged tap reads as
 * a broken switch.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import type { Device, DeviceStatePatch, MatterStatus } from '@/services/types';
import { describeApiError } from './describe-error';

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

/** Devices with no room of their own still have to appear somewhere. */
export const UNASSIGNED_ROOM = 'Unassigned';

/** The tab shown before any room is chosen. */
export const ALL_ROOMS = 'All';

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
    .map(([name, list]) => ({ name, devices: list }))
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
    /** Room names for the filter tabs, derived rather than hardcoded. */
    roomTabs: string[];
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

export function useDevices(): UseDevices {
  const [devices, setDevices] = useState<Device[]>([]);
  const [powerById, setPowerById] = useState<Record<string, boolean>>({});
  const [matter, setMatter] = useState<MatterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Read power state for the devices that have it.
   *
   * One dispatch call per device, in parallel, and a device that fails is simply
   * left unknown rather than failing the grid — a single unreachable bulb should
   * not blank the screen.
   */
  const readPower = useCallback(async (list: Device[]) => {
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
    setPowerById(
      Object.fromEntries(
        readings.filter((r): r is readonly [string, boolean] => r[1] !== undefined),
      ),
    );
  }, []);

  // The base URL and bearer token arrive asynchronously; fetching before they
  // land calls the default address unauthenticated and never retries.
  const { hydrated } = useServer();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listDevices();
      setDevices(list);
      void readPower(list);
    } catch (e) {
      setError(describeDeviceError(e));
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
  }, [readPower]);

  useEffect(() => {
    if (!hydrated) return;
    void refresh();
  }, [hydrated, refresh]);

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
      setDevices(await api.listDevices());
      return created.id;
    } catch (e) {
      setError(describeCommissionError(e));
      return null;
    }
  }, []);

  const remove = useCallback(
    async (device: Device) => {
      const previous = devices;
      setDevices((current) => current.filter((d) => d.id !== device.id));
      try {
        await api.deleteDevice(device.id);
      } catch (e) {
        setDevices(previous);
        setError(describeDeviceError(e));
      }
    },
    [devices],
  );

  const rooms = useMemo(() => groupByRoom(devices), [devices]);

  return {
    data: {
      devices,
      rooms,
      roomTabs: [ALL_ROOMS, ...rooms.map((r) => r.name)],
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
    if (e.status === 404) return 'That device is no longer registered with your Pond.';
    if (e.status === 409) return 'Your Pond will not remove a bridged endpoint on its own.';
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
  if (!(e instanceof ApiError)) {
    return 'Could not reach your Pond. Check that it is running on this network.';
  }
  switch (e.status) {
    case 503:
      return 'Your Pond is still starting its Matter controller. Wait a moment and try again.';
    case 502:
      return 'Your Pond could not reach its Matter controller, or the device refused to pair. Power-cycle the device and try again — a device only accepts pairing for about 15 minutes after it starts up.';
    case 400:
      return 'That setup code was not accepted. Check the code on the device or its packaging.';
    default:
      return describeApiError(e);
  }
}
