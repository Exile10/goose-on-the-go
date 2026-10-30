/**
 * What a tapped notification opens. The tap reads back the data stored in the
 * shade, so each case goes through the same listener a real tap does.
 */

import { Linking } from 'react-native';

import { presentLocally, watchLinkTaps } from '@/services/local-notifications';

const mockPush = jest.fn();
const mockSchedule = jest.fn().mockResolvedValue('id');
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));

let mockListener: ((response: unknown) => void) | null = null;
jest.mock('@/services/notifications-module', () => ({
  notifications: {
    addNotificationResponseReceivedListener: (fn: (response: unknown) => void) => {
      mockListener = fn;
      return { remove: jest.fn() };
    },
    getLastNotificationResponseAsync: () => Promise.resolve(null),
    clearLastNotificationResponse: jest.fn(),
    setNotificationHandler: jest.fn(),
    scheduleNotificationAsync: (...args: unknown[]) => mockSchedule(...args),
  },
}));

let next = 0;

/** Tap a notification carrying `data`, under an identifier no earlier tap used. */
function tap(data: Record<string, unknown>, identifier = `n-${next++}`): void {
  mockListener?.({ notification: { request: { identifier, content: { data } } } });
}

describe('openTapped', () => {
  let stop: () => void;
  beforeEach(() => {
    mockPush.mockClear();
    stop = watchLinkTaps();
  });
  afterEach(() => stop());

  it('opens the schedule a schedule notification names', () => {
    tap({ id: 'a', open: 'schedule', schedule_id: 'sched-1', run_id: 'run-9' });
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(stack)/schedule', params: { schedule_id: 'sched-1' } });
  });

  it('opens the devices tab and the chat tab', () => {
    tap({ open: 'devices' });
    tap({ open: 'chat', proposal_id: 'p-1' });
    expect(mockPush.mock.calls).toEqual([['/(tabs)/devices'], ['/(tabs)/chat']]);
  });

  it('opens nothing for a screen outside the allow-list, or no hint at all', () => {
    tap({ open: '/(stack)/developer' });
    tap({ id: 'b', category: 'info' });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('still opens the ride screen for a ride offer', () => {
    tap({
      action: 'ride_offer',
      provider: 'uber',
      dropoff: { name: 'JKIA', latitude: -1.319167, longitude: 36.9275 },
    });
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/ride',
      params: { name: 'JKIA', latitude: '-1.319167', longitude: '36.9275', provider: 'uber' },
    });
  });

  it('still opens a link with the system handler, not a screen', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    tap({ action: 'open_url', kind: 'directions', url: 'https://maps.apple.com/?daddr=Kisumu', open: 'chat' });
    expect(open).toHaveBeenCalledWith('https://maps.apple.com/?daddr=Kisumu');
    expect(mockPush).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('acts on one tap once, however many times it is delivered', () => {
    tap({ open: 'devices' }, 'same');
    tap({ open: 'devices' }, 'same');
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe('presentLocally', () => {
  it('stores a checked screen hint for the tap, and nothing else the Pond sent', async () => {
    await presentLocally({
      id: 'n-1',
      target: 'broadcast',
      category: 'alert',
      title: 'Schedule: Daily Brief',
      body: 'Task failed',
      timestamp: '2026-10-19T08:00:00Z',
      data: { open: 'schedule', schedule_id: 'sched-1', run_id: '../x', extra: 'dropped' },
    });
    expect(mockSchedule.mock.calls[0][0].content.data).toEqual({
      id: 'n-1',
      category: 'alert',
      open: 'schedule',
      schedule_id: 'sched-1',
    });
  });

  it('says whether it reached the shade, so a pull only acknowledges what was shown', async () => {
    const notice = { id: 'n-2', target: 'phone', category: 'info', title: 't', body: 'b', timestamp: '' };
    await expect(presentLocally(notice)).resolves.toBe(true);

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockSchedule.mockRejectedValueOnce(new Error('no permission'));
    await expect(presentLocally(notice)).resolves.toBe(false);
    warn.mockRestore();
  });
});

// Android shows a heads-up banner only for a HIGH-importance channel, and never raises the
// importance of a channel that already exists, so Updates moved to a new id.
describe('notification channels', () => {
  // The tap tests above already loaded the module-level mock of notifications-module, and an
  // isolated require reuses a cached mock before it consults a fresh doMock factory.
  beforeEach(() => jest.resetModules());
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  function configureOnAndroid() {
    const setNotificationChannelAsync = jest.fn(async () => null);
    const deleteNotificationChannelAsync = jest.fn(async () => undefined);
    const fake = {
      AndroidImportance: { DEFAULT: 3, HIGH: 4 },
      setNotificationHandler: jest.fn(),
      setNotificationChannelAsync,
      deleteNotificationChannelAsync,
    };
    let configure: () => Promise<void> = async () => undefined;
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'android' }, Linking: { openURL: jest.fn() } }));
      jest.doMock('expo-router', () => ({ router: { push: jest.fn() } }));
      jest.doMock('@/services/notifications-module', () => ({ notifications: fake }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ({ configureLocalNotifications: configure } = require('@/services/local-notifications'));
    });
    return { configure, setNotificationChannelAsync, deleteNotificationChannelAsync };
  }

  it('creates Updates at HIGH importance under its new id', async () => {
    const { configure, setNotificationChannelAsync } = configureOnAndroid();
    await configure();
    expect(setNotificationChannelAsync).toHaveBeenCalledWith('giap-info-v2', {
      name: 'Updates',
      importance: 4,
    });
    expect(setNotificationChannelAsync).toHaveBeenCalledWith(
      'giap-alerts',
      expect.objectContaining({ importance: 4 }),
    );
    expect(setNotificationChannelAsync).not.toHaveBeenCalledWith('giap-info', expect.anything());
  });

  it('deletes the old DEFAULT-importance Updates channel', async () => {
    const { configure, deleteNotificationChannelAsync } = configureOnAndroid();
    await configure();
    expect(deleteNotificationChannelAsync).toHaveBeenCalledWith('giap-info');
  });
});
