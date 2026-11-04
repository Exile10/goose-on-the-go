/**
 * Moving devices between rooms, as the device edits that carry it out.
 *
 * A room is a record of its own on the Pond (`/rooms`), and a device names the one it is in by
 * `room_id`. Making, renaming and deleting a room are calls of their own; what is here is the part
 * that moves devices: into a new room, or out of one about to be deleted. Neither returns an edit
 * for a device that is already where it would go.
 */

import type { Device } from '@/services/types';
import type { DeviceEdit } from './use-devices';

function moveTo(device: Device, roomId: string | null): DeviceEdit {
  return { device, name: device.name, roomId };
}

/** The chosen devices, moved into `roomId`. */
export function moveIntoRoom(devices: Device[], ids: ReadonlySet<string>, roomId: string): DeviceEdit[] {
  return devices.filter((d) => ids.has(d.id) && d.room_id !== roomId).map((d) => moveTo(d, roomId));
}

/** Every device in `roomId`, moved to Unassigned: what has to happen before the room can go. */
export function unassignRoom(devices: Device[], roomId: string): DeviceEdit[] {
  return devices.filter((d) => d.room_id === roomId).map((d) => moveTo(d, null));
}
