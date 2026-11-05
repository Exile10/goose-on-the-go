/**
 * Rooms against a Pond that keeps them as records of their own (`/rooms`), and against one from
 * before, which only names them on its devices.
 *
 * Pinned here: the rooms the screen shows are the Pond's, empty ones included; moving devices into
 * or out of a room sends one update per device that has to move and none for any other; an older
 * Pond's rooms are read from its devices and cannot be changed; and a refusal is reported in words
 * instead of swallowed.
 */

import { ApiError } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { Device, Room, UpdateDeviceRequest } from '@/services/types';
import {
  UNASSIGNED_ROOM,
  applyEdits,
  describeEditOutcome,
  describeRoomError,
  groupByRoom,
  mergeSaved,
  readRooms,
} from '@/view-models/use-devices';
import { moveIntoRoom, unassignRoom } from '@/view-models/rooms';

function device(id: string, roomId?: string, over: Partial<Device> = {}): Device {
  return { id, name: `Device ${id}`, is_online: true, room_id: roomId, ...over };
}

const ROOMS: Room[] = [
  { id: 'kitchen', name: 'Kitchen' },
  { id: 'bedroom', name: 'Bedroom' },
  { id: 'study', name: 'Study' },
];

const HOUSE = [device('lamp', 'kitchen'), device('kettle', 'kitchen'), device('fan', 'bedroom'), device('plug')];

/** A Pond that answers each PUT with the row as it would store it, refusing the ids it is told to. */
function pond(refuse: Record<string, ApiError> = {}) {
  const calls: [string, UpdateDeviceRequest][] = [];
  const client = {
    updateDevice: jest.fn(async (id: string, req: UpdateDeviceRequest): Promise<Device> => {
      calls.push([id, req]);
      if (refuse[id]) throw refuse[id];
      return { id, name: req.name, is_online: true, room_id: req.room_id };
    }),
  };
  return { client, calls };
}

describe('the rooms the screen shows', () => {
  it('are the Pond’s rooms by name, empty ones too, with Unassigned last', () => {
    const rooms = groupByRoom(HOUSE, ROOMS);
    expect(rooms.map((r) => [r.id, r.devices.length])).toEqual([
      ['bedroom', 1],
      ['kitchen', 2],
      ['study', 0],
      [UNASSIGNED_ROOM, 1],
    ]);
  });
});

describe('reading the rooms', () => {
  it('takes the Pond’s list as it is', async () => {
    const read = await readRooms({ listRooms: jest.fn().mockResolvedValue(ROOMS) }, HOUSE);
    expect(read).toEqual({ rooms: ROOMS, devices: HOUSE, editable: true });
  });

  /** A Pond from before `/rooms` named a device's room in free text; those rooms are only shown. */
  it('reads an older Pond’s rooms from its devices, and offers no changes', async () => {
    const older = [device('lamp', undefined, { room: 'Kitchen' }), device('plug')];
    const read = await readRooms({ listRooms: jest.fn().mockRejectedValue(new ApiError('GET', 404, null, null)) }, older);
    expect(read.editable).toBe(false);
    expect(groupByRoom(read.devices, read.rooms).map((r) => [r.name, r.devices.length])).toEqual([
      ['Kitchen', 1],
      ['', 1],
    ]);
  });

  it('leaves any other failure to the read that asked', async () => {
    const down = new ApiError('GET', 500, null, null);
    await expect(readRooms({ listRooms: jest.fn().mockRejectedValue(down) }, HOUSE)).rejects.toBe(down);
  });
});

describe('deleting a room', () => {
  it('first moves its devices out with a null room, and leaves every other device alone', async () => {
    const { client, calls } = pond();
    const edits = unassignRoom(HOUSE, 'kitchen');
    expect(edits).toHaveLength(2);

    const outcome = await applyEdits(client, edits);
    expect(calls.map(([, req]) => req.room_id)).toEqual([null, null]);
    // The name goes back as it was: the Pond requires one, and a room move must not change it.
    expect(calls.find(([id]) => id === 'lamp')?.[1].name).toBe('Device lamp');
    expect(client.updateDevice).not.toHaveBeenCalledWith('fan', expect.anything());
    const rooms = groupByRoom(mergeSaved(HOUSE, outcome.saved), ROOMS);
    expect(rooms.find((r) => r.id === UNASSIGNED_ROOM)?.devices).toHaveLength(3);
    expect(rooms.find((r) => r.id === 'kitchen')?.devices).toEqual([]);
  });

  it('is refused in words while the Pond still has a device in it', () => {
    expect(describeRoomError(new ApiError('DELETE', 409, null, null))).toBe(i18n.t('rooms.errors.notEmpty'));
  });
});

describe('adding a room', () => {
  it('moves only the chosen devices that are not already there', () => {
    const edits = moveIntoRoom(HOUSE, new Set(['plug', 'fan', 'lamp']), 'bedroom');
    expect(edits.map((e) => [e.device.id, e.roomId])).toEqual([
      ['lamp', 'bedroom'],
      ['plug', 'bedroom'],
    ]);
  });
});

/**
 * Another member's phone is listed with the household's devices, and the Pond lets only that phone
 * or the host change its row. Emptying a room that holds one still moves everything else.
 */
describe('a room move the Pond refuses in part', () => {
  it('moves the rest and says how many were not moved, and why', async () => {
    const house = [...HOUSE, device('liz-phone', 'kitchen', { device_type: 'gotg' })];
    const { client } = pond({ 'liz-phone': new ApiError('PUT', 403, null, 'device_not_yours') });
    const edits = unassignRoom(house, 'kitchen');
    const outcome = await applyEdits(client, edits);

    expect(outcome.saved.map((d) => d.id).sort()).toEqual(['kettle', 'lamp']);
    expect(outcome.failed.map((f) => f.edit.device.id)).toEqual(['liz-phone']);
    expect(describeEditOutcome(outcome, edits.length)).toBe(
      i18n.t('errors.someDevicesNotSaved', { count: 1, total: 3, reason: i18n.t('errors.deviceNotYours') }),
    );
  });

  it('is silent when every edit landed', async () => {
    const { client } = pond();
    expect(describeEditOutcome(await applyEdits(client, unassignRoom(HOUSE, 'bedroom')), 1)).toBeNull();
  });
});
