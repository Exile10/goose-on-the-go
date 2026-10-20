/**
 * Room operations, as the device edits that carry them out.
 *
 * The Pond has no rooms API. A room is the `room` field its devices share, so a room exists only
 * while a device is in it: renaming one changes that field on each of its devices, deleting one
 * clears it, and adding one means moving devices into a new name. Each planner returns the edits
 * for `useDevices().actions.edit`, and none for a device that is already where it would go.
 */

import type { Device } from '@/services/types';
import { UNASSIGNED_ROOM, roomOf, type DeviceEdit } from './use-devices';

function moveTo(device: Device, room: string | null): DeviceEdit {
  return { device, name: device.name, room };
}

/** Every device in `from`, moved to `to`. Moving into a room that exists already merges the two. */
export function renameRoom(devices: Device[], from: string, to: string): DeviceEdit[] {
  const name = to.trim();
  if (!name || name === from || from === UNASSIGNED_ROOM) return [];
  return devices.filter((d) => roomOf(d) === from).map((d) => moveTo(d, name));
}

/** Every device in `room`, moved to Unassigned, which is what deleting the room means. */
export function unassignRoom(devices: Device[], room: string): DeviceEdit[] {
  if (room === UNASSIGNED_ROOM) return [];
  return devices.filter((d) => roomOf(d) === room).map((d) => moveTo(d, null));
}

/** The chosen devices, moved into `room`: how a new room comes to exist. */
export function moveIntoRoom(devices: Device[], ids: ReadonlySet<string>, room: string): DeviceEdit[] {
  const name = room.trim();
  if (!name) return [];
  return devices.filter((d) => ids.has(d.id) && roomOf(d) !== name).map((d) => moveTo(d, name));
}
