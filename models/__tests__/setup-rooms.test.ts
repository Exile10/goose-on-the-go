/**
 * Setup's rooms step (issue #166): what it offers to place, what a found device is called, and
 * which rooms it suggests.
 */

import i18n from '@/services/i18n';
import type { Device } from '@/services/types';
import { foundName, isPlaceable, placeable, roomSuggestions } from '@/models/setup-rooms';

const t = i18n.t.bind(i18n);

function device(id: string, deviceType: string): Device {
  return { id, name: id, device_type: deviceType, is_online: true };
}

describe('the devices setup offers rooms to', () => {
  /** A phone or desktop is a person's, and only it may change its own row. */
  it('leaves out phones, desktops and the command line', () => {
    expect(isPlaceable(device('phone', 'gotg'))).toBe(false);
    expect(isPlaceable(device('desk', 'desktop'))).toBe(false);
    expect(isPlaceable(device('cli', 'cli'))).toBe(false);
  });

  it('offers lights, plugs and hubs, by name', () => {
    const list = placeable([device('Kettle', 'plug'), device('phone', 'gotg'), device('Bedside', 'light'), device('Hub', 'bridge')]);
    expect(list.map((d) => d.name)).toEqual(['Bedside', 'Hub', 'Kettle']);
  });
});

describe('a device the Pond found', () => {
  it('is called by the name it gave', () => {
    expect(foundName({ device_identifier: 'a', name: ' Porch light ' }, t)).toBe('Porch light');
  });

  it('is called by its kind when it gave no name', () => {
    expect(foundName({ device_identifier: 'a', device_type: 0x0101 }, t)).toBe(t('setupRooms.kind.light'));
    expect(foundName({ device_identifier: 'b', device_type: 0x010a, name: '  ' }, t)).toBe(t('setupRooms.kind.plug'));
  });

  it('says it is a Matter device when its kind is not one setup names', () => {
    expect(foundName({ device_identifier: 'a', device_type: 0x9999 }, t)).toBe(t('setupRooms.kind.matter'));
    expect(foundName({ device_identifier: 'b' }, t)).toBe(t('setupRooms.kind.matter'));
  });
});

describe('suggested rooms', () => {
  it('offers the usual rooms a home does not have yet, matched as people read names', () => {
    const offered = roomSuggestions([{ id: 'k', name: ' kitchen ' }], t);
    expect(offered).not.toContain(t('setupRooms.suggest.kitchen'));
    expect(offered).toContain(t('setupRooms.suggest.livingRoom'));
  });

  it('offers none once a home has them all', () => {
    const all = roomSuggestions([], t).map((name, i) => ({ id: String(i), name }));
    expect(roomSuggestions(all, t)).toEqual([]);
  });
});
