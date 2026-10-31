/**
 * When the Android foreground service runs, and when the notification stream
 * stays open. Pure decisions, so the lifecycle the provider drives can be
 * checked without a device.
 */

import { shouldHoldStream, shouldRunService } from '@/services/background-connection';

// Hoisted above the import: keeps expo-notifications, and its Expo Go warning, out of a pure test.
jest.mock('@/services/local-notifications', () => ({ presentLocally: jest.fn() }));

describe('shouldRunService', () => {
  it('runs on Android when paired and the setting is on', () => {
    expect(shouldRunService({ platform: 'android', paired: true, enabled: true })).toBe(true);
  });

  it('stops on unpair', () => {
    expect(shouldRunService({ platform: 'android', paired: false, enabled: true })).toBe(false);
  });

  it('stops when the setting is off', () => {
    expect(shouldRunService({ platform: 'android', paired: true, enabled: false })).toBe(false);
  });

  it('never runs on iOS or the web, which have no foreground services', () => {
    expect(shouldRunService({ platform: 'ios', paired: true, enabled: true })).toBe(false);
    expect(shouldRunService({ platform: 'web', paired: true, enabled: true })).toBe(false);
  });
});

describe('shouldHoldStream', () => {
  const android = { platform: 'android', paired: true, enabled: true };

  it('holds the stream in the foreground whatever the setting', () => {
    expect(shouldHoldStream({ ...android, enabled: false, active: true })).toBe(true);
    expect(shouldHoldStream({ ...android, platform: 'ios', active: true })).toBe(true);
  });

  it('holds it in the background only while the service does', () => {
    expect(shouldHoldStream({ ...android, active: false })).toBe(true);
    expect(shouldHoldStream({ ...android, enabled: false, active: false })).toBe(false);
    expect(shouldHoldStream({ ...android, platform: 'ios', active: false })).toBe(false);
  });

  it('never holds it without a pairing', () => {
    expect(shouldHoldStream({ ...android, paired: false, active: true })).toBe(false);
    expect(shouldHoldStream({ ...android, paired: false, active: false })).toBe(false);
  });
});
