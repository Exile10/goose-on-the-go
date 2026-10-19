/**
 * Rooms and device edits against a Pond that has no rooms API.
 *
 * A room is the `room` field its devices share, so every room operation is a set of
 * `PUT /devices/{id}` calls. Pinned here: the rooms the screen shows are the devices' rooms, a
 * rename sends one update per device in the room and none for any other, deleting a room clears
 * the field rather than removing a device, and a refusal is reported instead of swallowed.
 */

import { ApiError } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { Device, UpdateDeviceRequest } from '@/services/types';
import {
  UNASSIGNED_ROOM,
  applyEdits,
  describeEditOutcome,
  groupByRoom,
  mergeSaved,
} from '@/view-models/use-devices';
import { moveIntoRoom, renameRoom, unassignRoom } from '@/view-models/rooms';

function device(id: string, room?: string, over: Partial<Device> = {}): Device {
  return { id, name: `Device ${id}`, is_online: true, room, ...over };
}

const HOUSE = [
  device('lamp', 'Kitchen'),
  device('kettle', ' Kitchen '),
  device('fan', 'Bedroom'),
  device('plug'),
];

/** A Pond that answers each PUT with the row as it would store it, refusing the ids it is told to. */
function pond(refuse: Record<string, ApiError> = {}) {
  const calls: [string, UpdateDeviceRequest][] = [];
  const client = {
    updateDevice: jest.fn(async (id: string, req: UpdateDeviceRequest): Promise<Device> => {
      calls.push([id, req]);
      if (refuse[id]) throw refuse[id];
      return { id, name: req.name, is_online: true, room: req.room || undefined };
    }),
  };
  return { client, calls };
}

describe('the rooms the screen shows', () => {
  it('are the rooms the devices are in, with their counts, and Unassigned last', () => {
    const rooms = groupByRoom(HOUSE);
    expect(rooms.map((r) => [r.name, r.devices.length])).toEqual([
      ['Bedroom', 1],
      ['Kitchen', 2],
      [UNASSIGNED_ROOM, 1],
    ]);
  });
});

describe('renaming a room', () => {
  it('sends one update per device in the room, and none for any other device', async () => {
    const { client, calls } = pond();
    const outcome = await applyEdits(client, renameRoom(HOUSE, 'Kitchen', '  Galley '));

    expect(calls.map(([id]) => id).sort()).toEqual(['kettle', 'lamp']);
    for (const [, req] of calls) expect(req.room).toBe('Galley');
    // The name goes back as it was: the Pond requires one, and a room rename must not change it.
    expect(calls.find(([id]) => id === 'lamp')?.[1].name).toBe('Device lamp');
    expect(outcome.failed).toEqual([]);
    expect(groupByRoom(mergeSaved(HOUSE, outcome.saved)).map((r) => r.name)).toEqual(['Bedroom', 'Galley', UNASSIGNED_ROOM]);
  });

  it('sends nothing for an unchanged or blank name, or for Unassigned', () => {
    expect(renameRoom(HOUSE, 'Kitchen', 'Kitchen')).toEqual([]);
    expect(renameRoom(HOUSE, 'Kitchen', '   ')).toEqual([]);
    expect(renameRoom(HOUSE, UNASSIGNED_ROOM, 'Hall')).toEqual([]);
  });
});

describe('deleting a room', () => {
  it('moves its devices to Unassigned with a blank room, which the Pond reads as none', async () => {
    const { client, calls } = pond();
    const edits = unassignRoom(HOUSE, 'Kitchen');
    expect(edits).toHaveLength(2);

    const outcome = await applyEdits(client, edits);
    expect(calls.map(([, req]) => req.room)).toEqual(['', '']);
    expect(client.updateDevice).not.toHaveBeenCalledWith('fan', expect.anything());
    const rooms = groupByRoom(mergeSaved(HOUSE, outcome.saved));
    expect(rooms.find((r) => r.name === UNASSIGNED_ROOM)?.devices).toHaveLength(3);
    expect(rooms.some((r) => r.name === 'Kitchen')).toBe(false);
  });
});

describe('adding a room', () => {
  it('moves only the chosen devices that are not already there', () => {
    const edits = moveIntoRoom(HOUSE, new Set(['plug', 'fan', 'lamp']), 'Bedroom');
    expect(edits.map((e) => [e.device.id, e.room])).toEqual([
      ['lamp', 'Bedroom'],
      ['plug', 'Bedroom'],
    ]);
  });
});

/**
 * Another member's phone is listed with the household's devices, and the Pond lets only that phone
 * or the host change its row. A room holding one still moves everything else.
 */
describe('a room move the Pond refuses in part', () => {
  it('moves the rest and says how many were not moved, and why', async () => {
    const house = [...HOUSE, device('liz-phone', 'Kitchen', { device_type: 'gotg' })];
    const { client } = pond({ 'liz-phone': new ApiError('PUT', 403, null, 'device_not_yours') });
    const edits = renameRoom(house, 'Kitchen', 'Galley');
    const outcome = await applyEdits(client, edits);

    expect(outcome.saved.map((d) => d.id).sort()).toEqual(['kettle', 'lamp']);
    expect(outcome.failed.map((f) => f.edit.device.id)).toEqual(['liz-phone']);
    expect(describeEditOutcome(outcome, edits.length)).toBe(
      i18n.t('errors.someDevicesNotSaved', { count: 1, total: 3, reason: i18n.t('errors.deviceNotYours') }),
    );
  });

  it('is silent when every edit landed', async () => {
    const { client } = pond();
    expect(describeEditOutcome(await applyEdits(client, unassignRoom(HOUSE, 'Bedroom')), 1)).toBeNull();
  });
});
