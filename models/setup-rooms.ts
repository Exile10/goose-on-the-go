/**
 * Setup's rooms step (issue #166): which devices it offers to place, what a device the Pond found
 * but has not added is called, and the rooms it suggests.
 *
 * It runs once setup is done, because the Pond answers `/rooms` and `/devices` only then.
 */

import type { TFunction } from 'i18next';

import type { TranslationKey } from '@/services/i18n';
import type { Device, DiscoveredDevice, Room } from '@/services/types';

/**
 * The Pond's paired clients: phones, desktops and the command line. Each belongs to a person rather
 * than a room, and only that client may change its own row (`device_edit::may_edit`), so setup does
 * not offer them.
 */
const PAIRED_CLIENT_TYPES = new Set(['gotg', 'desktop', 'cli']);

/** Whether setup offers this device a room: anything the household has that is not a paired client. */
export function isPlaceable(device: Device): boolean {
  return !PAIRED_CLIENT_TYPES.has(device.device_type ?? '');
}

/** The devices setup offers rooms to, by name. */
export function placeable(devices: Device[]): Device[] {
  return devices.filter(isPlaceable).sort((a, b) => a.name.localeCompare(b.name));
}

/** Rooms most homes have, offered as one tap each. */
const SUGGESTED: TranslationKey[] = [
  'setupRooms.suggest.livingRoom',
  'setupRooms.suggest.kitchen',
  'setupRooms.suggest.bedroom',
  'setupRooms.suggest.bathroom',
  'setupRooms.suggest.office',
];

/** The suggested rooms the household does not have yet, as people read names: trimmed, any case. */
export function roomSuggestions(rooms: Room[], t: TFunction): string[] {
  const have = new Set(rooms.map((r) => r.name.trim().toLocaleLowerCase()));
  return SUGGESTED.map((key) => t(key)).filter((name) => !have.has(name.toLocaleLowerCase()));
}

/**
 * Matter device types by number, in words, for a found device that gave no name. Only the kinds a
 * home is likely to set up; any other says it is a Matter device.
 */
const MATTER_TYPES: Record<number, TranslationKey> = {
  0x0100: 'setupRooms.kind.light',
  0x0101: 'setupRooms.kind.light',
  0x010c: 'setupRooms.kind.light',
  0x010d: 'setupRooms.kind.light',
  0x010a: 'setupRooms.kind.plug',
  0x010b: 'setupRooms.kind.plug',
  0x002b: 'setupRooms.kind.fan',
  0x0301: 'setupRooms.kind.thermostat',
  0x000a: 'setupRooms.kind.lock',
  0x0202: 'setupRooms.kind.blind',
  0x000e: 'setupRooms.kind.hub',
};

/** What a found device is called: the name it gave, or its kind, or that it is a Matter device. */
export function foundName(device: DiscoveredDevice, t: TFunction): string {
  const name = device.name?.trim();
  if (name) return name;
  const kind = device.device_type != null ? MATTER_TYPES[device.device_type] : undefined;
  return t(kind ?? 'setupRooms.kind.matter');
}
