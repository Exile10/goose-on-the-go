/**
 * The device logic that decides what the UI is allowed to offer.
 *
 * Each of these guards a specific way the screen used to be wrong: every device
 * rendered as on, every device offered a switch, rooms came from a hardcoded
 * list, and a bridged endpoint would have been offered a delete the server
 * refuses.
 */

import {
  UNASSIGNED_ROOM,
  groupByRoom,
  isAppWindow,
  isBridgedEndpoint,
  parsePowerState,
  supports,
  listPollStillCurrent,
  powerPollStillCurrent,
  staleFor,
  mergePower,
  ALL_ROOMS,
  roomLabel,
  legacyRooms,
  nameTaken,
} from '@/view-models/use-devices';
import type { Device } from '@/services/types';
import i18n from '@/services/i18n';

function device(over: Partial<Device> = {}): Device {
  return { id: 'd1', name: 'Lamp', is_online: true, ...over };
}

describe('supports', () => {
  it('reads the verb list the controller derived from the device', () => {
    expect(supports(device({ capabilities: ['power', 'brightness'] }), 'power')).toBe(true);
    expect(supports(device({ capabilities: ['power'] }), 'brightness')).toBe(false);
  });

  /**
   * THE regression. An unmapped device arrives typed `matter` with no
   * capabilities, and absent must not mean "everything" — that is how a contact
   * sensor gets offered a power button.
   */
  it('offers nothing when the device declared no capabilities', () => {
    expect(supports(device({ capabilities: [] }), 'power')).toBe(false);
    expect(supports(device({ capabilities: undefined }), 'power')).toBe(false);
  });
});

describe('isAppWindow', () => {
  it('takes the dashboard and the desktop app, which pair as desktop', () => {
    expect(isAppWindow(device({ device_type: 'desktop' }))).toBe(true);
    expect(isAppWindow(device({ device_type: 'Desktop' }))).toBe(true);
  });

  it('leaves phones and smart-home devices alone', () => {
    expect(isAppWindow(device({ device_type: 'gotg' }))).toBe(false);
    expect(isAppWindow(device({ device_type: 'light' }))).toBe(false);
    expect(isAppWindow(device({ device_type: undefined }))).toBe(false);
  });
});

describe('parsePowerState', () => {
  it('reads the power line out of the tool text', () => {
    expect(parsePowerState('name: Lamp\npower: on\nbrightness: 80')).toBe(true);
    expect(parsePowerState('power: off')).toBe(false);
  });

  /**
   * Undefined is a third state, not a synonym for off. A device that reports no
   * power at all must not render a switch sitting in the off position.
   */
  it('returns undefined when no power was reported', () => {
    expect(parsePowerState('name: Door sensor\ncontact: closed')).toBeUndefined();
    expect(parsePowerState('power: something-else')).toBeUndefined();
    expect(parsePowerState('')).toBeUndefined();
  });

  it('does not match a line that merely mentions power', () => {
    expect(parsePowerState('note: power consumption is low')).toBeUndefined();
  });
});

describe('groupByRoom', () => {
  const ROOMS = [
    { id: 'r-kitchen', name: 'Kitchen' },
    { id: 'r-bedroom', name: 'Bedroom' },
    { id: 'r-attic', name: 'Attic' },
  ];

  it('groups by the room the server recorded, by name', () => {
    const rooms = groupByRoom(
      [
        device({ id: 'a', room_id: 'r-kitchen' }),
        device({ id: 'b', room_id: 'r-bedroom' }),
        device({ id: 'c', room_id: 'r-kitchen' }),
      ],
      ROOMS,
    );

    expect(rooms.map((r) => r.name)).toEqual(['Attic', 'Bedroom', 'Kitchen']);
    expect(rooms[2].devices).toHaveLength(2);
  });

  /** A room is the household's whether or not anything is in it yet. */
  it('keeps a room with no devices in it', () => {
    const rooms = groupByRoom([device({ id: 'a', room_id: 'r-kitchen' })], ROOMS);
    expect(rooms.find((r) => r.id === 'r-attic')?.devices).toEqual([]);
  });

  /** A device with no room still has to appear, and it sorts last. */
  it('collects room-less devices under Unassigned, at the end', () => {
    const rooms = groupByRoom(
      [device({ id: 'a' }), device({ id: 'b', room_id: null }), device({ id: 'c', room_id: 'r-attic' })],
      ROOMS,
    );

    expect(rooms.map((r) => r.id)).toEqual(['r-attic', 'r-bedroom', 'r-kitchen', UNASSIGNED_ROOM]);
    expect(rooms[3].devices).toHaveLength(2);
  });

  /** Another phone made the room a moment ago; until it is read here, the device is in none. */
  it('puts a device in a room this phone has not read yet under Unassigned', () => {
    const rooms = groupByRoom([device({ id: 'a', room_id: 'r-new' })], []);
    expect(rooms.map((r) => r.id)).toEqual([UNASSIGNED_ROOM]);
  });
});

describe('legacyRooms', () => {
  /** A Pond from before `/rooms` named rooms in each device's free text. */
  it('makes one room per name a device carries, with its devices in it', () => {
    const { rooms, devices } = legacyRooms([
      device({ id: 'a', room: 'Kitchen ' }),
      device({ id: 'b', room: 'Kitchen' }),
      device({ id: 'c', room: '  ' }),
    ]);
    expect(rooms).toEqual([{ id: 'Kitchen', name: 'Kitchen' }]);
    expect(groupByRoom(devices, rooms).map((r) => [r.id, r.devices.length])).toEqual([
      ['Kitchen', 2],
      [UNASSIGNED_ROOM, 1],
    ]);
  });
});

describe('nameTaken', () => {
  const rooms = [{ id: 'k', name: 'Kitchen' }];

  it('matches a name as a person reads it, trimmed and in any case', () => {
    expect(nameTaken(rooms, ' kitchen ')).toBe(true);
    expect(nameTaken(rooms, 'Study')).toBe(false);
  });

  it('lets a room keep its own name', () => {
    expect(nameTaken(rooms, 'KITCHEN', 'k')).toBe(false);
  });
});

describe('isBridgedEndpoint', () => {
  /**
   * One node is not one device. DELETE refuses these, so the UI must not offer
   * it — a button that always fails is worse than no button.
   */
  it('recognises a bridged Matter endpoint id', () => {
    expect(isBridgedEndpoint('matter-12345-3')).toBe(true);
  });

  it('leaves ordinary devices alone', () => {
    expect(isBridgedEndpoint('matter-12345')).toBe(false);
    expect(isBridgedEndpoint('kitchen-lamp')).toBe(false);
  });
});

/**
 * Devices poll, and a poll is slower than a tap. One that read the lamp as off just before you
 * switched it on would land afterwards and switch it back off on screen -- and if it landed after
 * the switch's own read-back, it would stay wrong until the next poll. The rule: a poll never
 * overrides anything changed after that poll began.
 */
describe('a poll does not undo what was done after it began', () => {
  it('keeps a power state changed after the poll started', () => {
    const current = { lamp: true, fan: false };
    const fresh = { lamp: false, fan: false };
    expect(mergePower(current, fresh, { lamp: 2_000 }, 1_000)).toEqual({ lamp: true, fan: false });
  });

  it('takes the poll for a device changed before it started', () => {
    const current = { lamp: true };
    const fresh = { lamp: false };
    expect(mergePower(current, fresh, { lamp: 500 }, 1_000)).toEqual({ lamp: false });
  });

  // A device the poll no longer reports is unknown, which is a real answer -- unless it was
  // changed after the poll began, when the poll has not seen it yet.
  it('drops a device the poll no longer reports, unless it was just changed', () => {
    expect(mergePower({ lamp: true }, {}, {}, 1_000)).toEqual({});
    expect(mergePower({ lamp: true }, {}, { lamp: 2_000 }, 1_000)).toEqual({ lamp: true });
  });

  // Removing or adding a device changes the list. A poll that began before that would put a
  // deleted device back.
  it('does not apply a device list that began before the list was changed', () => {
    expect(listPollStillCurrent(1_000, 2_000)).toBe(false);
    expect(listPollStillCurrent(1_000, 1_000)).toBe(false);
    expect(listPollStillCurrent(3_000, 2_000)).toBe(true);
    expect(listPollStillCurrent(1_000, 0)).toBe(true);
  });
});

/**
 * The room names the app makes up itself -- the no-room bucket and the "all" tab -- are ids, shown
 * through the catalogue. They used to be the English words, rendered raw, which also made them
 * collide with a room the household had actually named "Unassigned" or "All".
 */
describe('room labels', () => {
  it('shows the fallback room and the all tab as copy, not as their ids', () => {
    expect(roomLabel({ id: UNASSIGNED_ROOM, name: '' })).toBe(i18n.t('devices.roomUnassigned'));
    expect(roomLabel({ id: ALL_ROOMS, name: '' })).toBe(i18n.t('devices.roomAll'));
    expect(roomLabel({ id: UNASSIGNED_ROOM, name: '' })).not.toBe(UNASSIGNED_ROOM);
  });

  it('shows a room the household named exactly as it was named', () => {
    expect(roomLabel({ id: 'r1', name: 'Kitchen' })).toBe('Kitchen');
  });

  it('keeps a room literally named "Unassigned" apart from devices that have no room', () => {
    const named = { id: 'a', name: 'a', is_online: true, room_id: 'r-u' } as Device;
    const none = { id: 'b', name: 'b', is_online: true } as Device;
    const rooms = groupByRoom([named, none], [{ id: 'r-u', name: 'Unassigned' }]);
    expect(rooms.map((r) => r.id)).toEqual(['r-u', UNASSIGNED_ROOM]);
    expect(rooms.map(roomLabel)).toEqual(['Unassigned', i18n.t('devices.roomUnassigned')]);
  });
});

/**
 * The poll loop does not wait for power reads, so an older poll's reads can land after a newer
 * poll's and must not be applied over them.
 */
describe('power readings from an older poll', () => {
  it('are not applied once a newer poll has applied its own', () => {
    expect(powerPollStillCurrent(1_000, 2_000)).toBe(false);
  });

  it('are applied when they are the newest', () => {
    expect(powerPollStillCurrent(3_000, 2_000)).toBe(true);
    expect(powerPollStillCurrent(1_000, 0)).toBe(true);
  });
});

describe('how old the list on screen is', () => {
  const at = Date.parse('2026-10-27T06:30:00Z');

  it('says nothing while the last read worked', () => {
    expect(staleFor(at, null)).toBeNull();
  });

  it('says nothing before anything has loaded', () => {
    expect(staleFor(null, at)).toBeNull();
  });

  it('gives the age of the last good read once a later one fails', () => {
    expect(staleFor(at, at + 5 * 60_000)).toBe('5 min');
  });

  it('ignores a failure from before the last good read', () => {
    expect(staleFor(at, at - 1)).toBeNull();
  });
});
