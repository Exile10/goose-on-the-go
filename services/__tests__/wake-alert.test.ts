/**
 * The iPhone's fixed wake line: taken out of the shade once a fetch has shown what it stood for,
 * and, when tapped, answered by the fetch rather than by anything the line carries.
 */

import { Platform } from 'react-native';

import type { ServerNotification } from '@/services/notification-stream';
import { dismissWakeAlerts, noteDrained, noteFetched, noteWakeTap, resetWakeAlerts, watchWakeTaps } from '@/services/wake-alert';

jest.mock('@/services/notifications-module', () => ({ notifications: null }));

const notice = (id: string): ServerNotification => ({ id, target: 'phone', category: 'info', title: 't', body: 'b', timestamp: '' });

const wakeLine = (identifier: string) => ({
  request: {
    identifier,
    content: { title: 'Goose', data: null },
    trigger: { type: 'push', payload: { wake: '1', notification_id: 'n-1', category: 'info', aps: { alert: {} } } },
  },
});
const ownNotice = (identifier: string) => ({ request: { identifier, content: { data: { id: identifier, category: 'info' } }, trigger: null } });

function shade(presented: unknown[]) {
  const dismissed: string[] = [];
  return {
    dismissed,
    module: {
      getPresentedNotificationsAsync: jest.fn(async () => presented),
      dismissNotificationAsync: jest.fn(async (id: string) => { dismissed.push(id); }),
    } as unknown as Parameters<typeof dismissWakeAlerts>[2],
  };
}

const os = Platform.OS;
beforeEach(() => {
  Platform.OS = 'ios';
  resetWakeAlerts();
});
afterAll(() => {
  Platform.OS = os;
});

describe('dismissWakeAlerts', () => {
  it('dismisses every wake line and none of the app\'s own notices', async () => {
    const { module, dismissed } = shade([wakeLine('apns-1'), ownNotice('n-1'), wakeLine('apns-2')]);
    const present = jest.fn(async () => true);

    await expect(dismissWakeAlerts([notice('n-1')], present, module)).resolves.toBe(2);

    expect(dismissed).toEqual(['apns-1', 'apns-2']);
    expect(present).not.toHaveBeenCalled();
  });

  // iOS files a wake under its notice's id, so removing the line by that id can take the notice too.
  it('puts back a notice that shares the identifier of the line it dismissed', async () => {
    const { module, dismissed } = shade([wakeLine('n-1'), ownNotice('n-1')]);
    const present = jest.fn(async () => true);

    await dismissWakeAlerts([notice('n-1'), notice('n-2')], present, module);

    expect(dismissed).toEqual(['n-1']);
    expect(present.mock.calls).toEqual([[notice('n-1')]]);
  });

  it('asks the shade nothing on Android, which draws no wake line', async () => {
    Platform.OS = 'android';
    const { module } = shade([wakeLine('apns-1')]);
    await expect(dismissWakeAlerts([], async () => true, module)).resolves.toBe(0);
    expect(module?.getPresentedNotificationsAsync).not.toHaveBeenCalled();
  });

  it('survives a shade that cannot be read', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const module = { getPresentedNotificationsAsync: jest.fn(async () => { throw new Error('no module'); }), dismissNotificationAsync: jest.fn() };
    await expect(dismissWakeAlerts([], async () => true, module as unknown as Parameters<typeof dismissWakeAlerts>[2])).resolves.toBe(0);
    warn.mockRestore();
  });
});

describe('a tap waiting for a fetch', () => {
  const T0 = 1_000_000;
  let led: string[];
  beforeEach(() => {
    led = [];
    watchWakeTaps((n) => led.push(n.id));
  });

  it('leads to the one notice the next fetch finds', () => {
    noteWakeTap(T0);
    expect(led).toEqual([]);
    noteFetched([notice('n-1')], T0 + 400);
    noteDrained(T0 + 900);
    expect(led).toEqual(['n-1']);
  });

  it('leads at once to the one notice a fetch found moments before the tap', () => {
    noteFetched([notice('n-1')], T0);
    noteDrained(T0 + 300);
    noteWakeTap(T0 + 2_000);
    expect(led).toEqual(['n-1']);
  });

  it('counts a notice two overlapping fetches both returned once', () => {
    noteWakeTap(T0);
    noteFetched([notice('n-1')], T0 + 100);
    noteFetched([notice('n-1')], T0 + 150);
    noteDrained(T0 + 500);
    expect(led).toEqual(['n-1']);
  });

  it('leads nowhere when the fetch found several, and is answered only once', () => {
    noteWakeTap(T0);
    noteFetched([notice('n-1'), notice('n-2')], T0 + 100);
    noteDrained(T0 + 500);
    noteFetched([notice('n-3')], T0 + 20_000);
    noteDrained(T0 + 20_500);
    expect(led).toEqual([]);
  });

  it('leads nowhere when the fetch found nothing, or what it found is from long before the tap', () => {
    noteFetched([notice('n-old')], T0 - 60_000);
    noteWakeTap(T0);
    noteDrained(T0 + 500);
    expect(led).toEqual([]);
  });

  it('gives up on a fetch that takes longer than a minute', () => {
    noteWakeTap(T0);
    noteFetched([notice('n-1')], T0 + 61_000);
    noteDrained(T0 + 61_500);
    expect(led).toEqual([]);
  });

  it('answers nothing without a tap', () => {
    noteFetched([notice('n-1')], T0);
    noteDrained(T0 + 100);
    expect(led).toEqual([]);
  });
});
