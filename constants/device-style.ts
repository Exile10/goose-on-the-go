/**
 * How a device is drawn: which glyph, and which accent.
 *
 * The keys are the Pond's own `device_type` vocabulary rather than a guess, so
 * a type outside it lands on the neutral fallback instead of on a plausible but
 * wrong glyph — a camera icon on a door lock is worse than a generic one.
 *
 * Home and the Devices tab both read this. They showed the same device with two
 * different icons until they did.
 */

import type { Device } from '@/services/types';

import type { IconName } from './icons';
import { JaridaPurple } from './colors';

export interface DeviceStyle {
  icon: IconName;
  color: string;
}

const TYPE_STYLE: Record<string, DeviceStyle> = {
  light: { icon: 'light', color: '#F59E0B' },
  thermostat: { icon: 'thermo', color: '#1C63D1' },
  lock: { icon: 'lock', color: '#1F8A3C' },
  camera: { icon: 'camera', color: '#C8383B' },
  speaker: { icon: 'speaker', color: '#8C4BFF' },
  sensor: { icon: 'sensor', color: '#0E7490' },
  fan: { icon: 'fan', color: '#0891B2' },
  appliance: { icon: 'appliance', color: '#B45309' },
  alarm: { icon: 'alarm', color: '#C8383B' },
  bridge: { icon: 'bridge', color: '#6B7280' },
};

export const DEFAULT_DEVICE_STYLE: DeviceStyle = {
  icon: 'device',
  color: JaridaPurple[500],
};

export function deviceStyle(device: Device): DeviceStyle {
  return TYPE_STYLE[device.device_type?.toLowerCase() ?? ''] ?? DEFAULT_DEVICE_STYLE;
}
