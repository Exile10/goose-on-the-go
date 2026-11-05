/**
 * Setup's rooms step (issue #166): the household's rooms, its devices each placed in one with a
 * tap, and the devices the Pond can see but has not added yet.
 *
 * Rooms and placing are `useDevices`'s, so this step and Home management cannot disagree. The
 * found list is read once on open and again on refresh: it is the Pond listening on the network for
 * a few seconds, not something to poll. A Pond that cannot look (no list route, or its Matter
 * controller not up) leaves the list unavailable rather than the step broken.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, api } from '@/services/api-client';
import type { Device, DiscoveredDevice } from '@/services/types';
import { placeable, roomSuggestions } from '@/models/setup-rooms';
import { UNASSIGNED_ROOM, useDevices, type DeviceRoom } from './use-devices';

export type FoundState = 'loading' | 'ready' | 'unavailable';

export interface UseSetupRooms {
  data: {
    /** The household's rooms, by name; Unassigned is not one. */
    rooms: DeviceRoom[];
    /** The devices to place, by name: everything but phones, desktops and the command line. */
    devices: Device[];
    /** Rooms most homes have that this one does not yet, one tap each. */
    suggestions: string[];
    found: DiscoveredDevice[];
    foundState: FoundState;
    /** False on a Pond that cannot keep rooms of its own; the step then has nothing to set. */
    roomsEditable: boolean;
    loading: boolean;
    /** The id of the device whose room is being saved, so its chips wait. */
    placing: string | null;
  };
  /** Why the last change was refused, or why the list could not be read. */
  error: string | null;
  actions: {
    addRoom: (name: string) => Promise<boolean>;
    renameRoom: (room: DeviceRoom, name: string) => Promise<string | null>;
    removeRoom: (room: DeviceRoom) => Promise<void>;
    /** Puts the device in the room, or in none for null. */
    place: (device: Device, roomId: string | null) => Promise<void>;
    refresh: () => Promise<void>;
  };
}

export function useSetupRooms(): UseSetupRooms {
  const { t } = useTranslation();
  const { data, loading, error: readError, actions } = useDevices();
  const [found, setFound] = useState<DiscoveredDevice[]>([]);
  const [foundState, setFoundState] = useState<FoundState>('loading');
  const [placing, setPlacing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const look = useCallback(async () => {
    setFoundState('loading');
    try {
      setFound(await api.discoveredDevices());
      setFoundState('ready');
    } catch (e) {
      console.warn('[setup-rooms] the Pond could not look for devices', e instanceof ApiError ? e.status : 'network');
      setFound([]);
      setFoundState('unavailable');
    }
  }, []);

  useEffect(() => {
    // After this render, not inside it: the first look sets state.
    void Promise.resolve().then(look);
  }, [look]);

  const rooms = useMemo(() => data.rooms.filter((r) => r.id !== UNASSIGNED_ROOM), [data.rooms]);

  const addRoom = useCallback(
    async (name: string) => {
      const refused = await actions.createRoom(name, new Set());
      setError(refused);
      return refused === null;
    },
    [actions],
  );

  const removeRoom = useCallback(
    async (room: DeviceRoom) => {
      setError(await actions.deleteRoom(room));
    },
    [actions],
  );

  const place = useCallback(
    async (device: Device, roomId: string | null) => {
      if ((device.room_id ?? null) === roomId) return;
      setPlacing(device.id);
      const refused = await actions.edit([{ device, name: device.name, roomId }]);
      setPlacing(null);
      setError(refused);
    },
    [actions],
  );

  const refresh = useCallback(async () => {
    await Promise.all([actions.refresh(), look()]);
  }, [actions, look]);

  return {
    data: {
      rooms,
      devices: placeable(data.devices),
      suggestions: roomSuggestions(rooms, t),
      found,
      foundState,
      roomsEditable: data.roomsEditable,
      loading,
      placing,
    },
    error: error ?? readError,
    actions: { addRoom, renameRoom: actions.renameRoom, removeRoom, place, refresh },
  };
}
