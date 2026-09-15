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
  isBridgedEndpoint,
  parsePowerState,
  supports,
} from '@/view-models/use-devices';
import type { Device } from '@/services/types';

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
  it('groups by the room the server recorded, alphabetically', () => {
    const rooms = groupByRoom([
      device({ id: 'a', room: 'Kitchen' }),
      device({ id: 'b', room: 'Bedroom' }),
      device({ id: 'c', room: 'Kitchen' }),
    ]);

    expect(rooms.map((r) => r.name)).toEqual(['Bedroom', 'Kitchen']);
    expect(rooms[1].devices).toHaveLength(2);
  });

  /** A device with no room still has to appear, and it sorts last. */
  it('collects room-less devices under Unassigned, at the end', () => {
    const rooms = groupByRoom([
      device({ id: 'a' }),
      device({ id: 'b', room: '  ' }),
      device({ id: 'c', room: 'Attic' }),
    ]);

    expect(rooms.map((r) => r.name)).toEqual(['Attic', UNASSIGNED_ROOM]);
    expect(rooms[1].devices).toHaveLength(2);
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
