import { readWakePing, wakePingOfNotification } from '@/services/wake-ping';

const PING = { wake: '1', notification_id: 'n-1:phone-a', category: 'alert' };

describe('readWakePing', () => {
  it('reads an Android FCM data message as expo-notifications serialises it', () => {
    const payload = { data: { ...PING, dataString: null }, notification: null, messageId: 'm1', priority: 1 };
    expect(readWakePing(payload)).toEqual({ notificationId: 'n-1:phone-a', category: 'alert' });
  });

  it('reads an iOS silent push, with the custom keys beside aps', () => {
    const payload = { data: { ...PING }, notification: null, aps: { 'content-available': 1 } };
    expect(readWakePing(payload)).toEqual({ notificationId: 'n-1:phone-a', category: 'alert' });
  });

  it('reads the keys where iOS puts them, at the top beside aps, and says the alert is already visible', () => {
    const payload = { ...PING, aps: { alert: { title: 'Goose', body: 'Something new from your Pond.' }, 'content-available': 1 } };
    expect(readWakePing(payload)).toEqual({ notificationId: 'n-1:phone-a', category: 'alert', visible: true });
  });

  it('reads an iPhone wake as its background task is handed it, with the alert beside the data', () => {
    const payload = { data: { ...PING, dataString: null }, notification: { title: 'Goose', body: 'Something new from your Pond.' }, aps: { 'content-available': 1 } };
    expect(readWakePing(payload)?.visible).toBe(true);
  });

  it('treats a ping without a category as information', () => {
    expect(readWakePing({ data: { wake: '1', notification_id: 'n-2' } })?.category).toBe('info');
  });

  it.each([
    ['nothing', undefined],
    ['no data', { notification: null }],
    ['no wake flag', { data: { notification_id: 'n-1' } }],
    ['no id', { data: { wake: '1' } }],
    ['a tapped notification', { actionIdentifier: 'expo.modules.notifications.actions.DEFAULT', notification: {} }],
  ])('ignores %s', (_, payload) => {
    expect(readWakePing(payload)).toBeNull();
  });
});

describe('wakePingOfNotification', () => {
  const remote = (payload: Record<string, unknown>) => ({
    request: { identifier: 'n-1:phone-a', content: { title: 'Goose', data: null }, trigger: { type: 'push', payload } },
  });

  it('reads the wake behind a remote notification from its push payload', () => {
    const shade = remote({ ...PING, aps: { alert: { title: 'Goose', body: 'Something new from your Pond.' } } });
    expect(wakePingOfNotification(shade)).toEqual({ notificationId: 'n-1:phone-a', category: 'alert', visible: true });
  });

  it('is not a wake for one of the app\'s own notices, a remote notification of another kind, or nothing', () => {
    expect(wakePingOfNotification({ request: { identifier: 'n-1', content: { data: { id: 'n-1', category: 'alert' } }, trigger: null } })).toBeNull();
    expect(wakePingOfNotification(remote({ aps: { alert: 'Hello' } }))).toBeNull();
    expect(wakePingOfNotification({ request: { identifier: 'x', content: { data: { id: 'x' } } } })).toBeNull();
    expect(wakePingOfNotification(null)).toBeNull();
  });
});
