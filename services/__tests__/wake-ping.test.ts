import { readWakePing } from '@/services/wake-ping';

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
