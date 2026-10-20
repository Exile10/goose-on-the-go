import { readFileSync } from 'fs';
import { join } from 'path';

import appJson from '../../app.json';
import { Brand } from '@/constants/colors';

// Android draws the small icon from its alpha alone; scripts/make-icons.py makes it.
describe('the notification small icon', () => {
  const entry = appJson.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications',
  ) as [string, { icon: string; color: string }] | undefined;

  it('is configured for expo-notifications', () => {
    expect(entry).toBeDefined();
    expect(entry?.[1].icon).toBe('./assets/images/notification-icon.png');
  });

  it('is tinted the brand purple', () => {
    expect(entry?.[1].color.toUpperCase()).toBe(Brand.purple.toUpperCase());
  });

  it('is a 96x96 RGBA PNG, xxxhdpi for 24dp', () => {
    const png = readFileSync(join(__dirname, '../..', entry?.[1].icon ?? ''));
    // IHDR: width and height at bytes 16 and 20, colour type 6 (RGBA) at byte 25.
    expect(png.readUInt32BE(16)).toBe(96);
    expect(png.readUInt32BE(20)).toBe(96);
    expect(png[25]).toBe(6);
  });
});
