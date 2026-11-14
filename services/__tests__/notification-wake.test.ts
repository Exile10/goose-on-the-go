/**
 * The push wake-up: a content-free FCM message makes the phone fetch, show and
 * acknowledge what the Pond is holding. It runs headless and unsupervised, so
 * what matters is that it does exactly that, ignores anything else, and never
 * throws.
 */

import { Platform } from 'react-native';

import { presentLocally } from '@/services/local-notifications';
import { deliver, deliverAndAcknowledge, drainPending, onDelivered, type DeliveryClient } from '@/services/notification-delivery';
import type { ServerNotification } from '@/services/notification-stream';
import { handleWake, isWake } from '@/services/notification-wake';

// Hoisted above the imports by babel-jest; `mock`-prefixed so the factory may read it.
const mockPresented: string[] = [];
jest.mock('@/services/local-notifications', () => ({
  presentLocally: jest.fn(async (n: { id: string }) => { mockPresented.push(n.id); return true; }),
}));
const presented = mockPresented;
const present = presentLocally as jest.Mock;

// What iOS has in the shade, for the wake line's removal after a fetch.
const mockShade: unknown[] = [];
const mockDismissed: string[] = [];
jest.mock('@/services/notifications-module', () => ({
  notifications: {
    getPresentedNotificationsAsync: jest.fn(async () => mockShade),
    dismissNotificationAsync: jest.fn(async (id: string) => { mockDismissed.push(id); }),
  },
}));
const wakeLine = (identifier: string) => ({
  request: {
    identifier,
    content: { title: 'Goose', data: null },
    trigger: { type: 'push', payload: { wake: '1', notification_id: 'n-x', category: 'info', aps: { alert: {} } } },
  },
});

let seq = 0;
/** Ids unique per test: the delivery deduplicator lives for the whole runtime, as it does in the app. */
function notice(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return { id: `n-${seq}`, target: 'phone', category: 'info', title: 'Door', body: 'The back door opened', timestamp: '', ...overrides };
}

function fakeClient(pending: unknown): DeliveryClient & { acked: string[] } {
  const acked: string[] = [];
  return {
    acked,
    pendingNotifications: jest.fn(async () => {
      if (pending instanceof Error) throw pending;
      return pending as ServerNotification[];
    }),
    ackNotification: jest.fn(async (id: string) => { acked.push(id); }),
  };
}

const androidWake = (id = 'n-x') => ({ data: { notification_id: id, category: 'info', wake: '1' }, notification: null });

beforeEach(() => {
  Platform.OS = 'ios';
  mockShade.length = 0;
  mockDismissed.length = 0;
  presented.length = 0;
  present.mockClear();
  present.mockImplementation(async (n: { id: string }) => { presented.push(n.id); return true; });
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('isWake', () => {
  it('reads the Android data map, the iOS top-level keys and a dataString body', () => {
    expect(isWake(androidWake())).toBe(true);
    expect(isWake({ aps: { 'content-available': 1 }, wake: '1' })).toBe(true);
    expect(isWake({ data: { dataString: '{"wake":"1"}' } })).toBe(true);
  });

  it('is false for anything else', () => {
    expect(isWake(null)).toBe(false);
    expect(isWake({ data: { wake: '0' } })).toBe(false);
    expect(isWake({ actionIdentifier: 'default', notification: {} })).toBe(false);
  });

  it('reads an Android data message as expo-notifications serialises it, and an iOS one under data', () => {
    const ping = { wake: '1', notification_id: 'n-1:phone-a', category: 'alert' };
    expect(isWake({ data: { ...ping, dataString: null }, notification: null, messageId: 'm1', priority: 1 })).toBe(true);
    expect(isWake({ data: { ...ping }, notification: null, aps: { 'content-available': 1 } })).toBe(true);
    expect(isWake({ data: { notification_id: 'n-1' } })).toBe(false);
  });
});

describe('handleWake', () => {
  it('fetches pending notices, presents each, and acknowledges each', async () => {
    const a = notice();
    const b = notice({ category: 'alert' });
    const client = fakeClient([a, b]);

    const outcome = await handleWake(androidWake(a.id), { ensureSession: async () => true, client });

    expect(outcome).toBe('delivered');
    expect(presented).toEqual([a.id, b.id]);
    expect(client.acked).toEqual([a.id, b.id]);
  });

  it('ignores a payload that is not a wake-up without touching the Pond', async () => {
    const client = fakeClient([notice()]);
    const ensureSession = jest.fn(async () => true);

    const outcome = await handleWake({ data: { category: 'info' } }, { ensureSession, client });

    expect(outcome).toBe('ignored');
    expect(ensureSession).not.toHaveBeenCalled();
    expect(client.pendingNotifications).not.toHaveBeenCalled();
  });

  it('stops quietly when there is no pairing to restore', async () => {
    const client = fakeClient([notice()]);
    const outcome = await handleWake(androidWake(), { ensureSession: async () => false, client });
    expect(outcome).toBe('unpaired');
    expect(client.pendingNotifications).not.toHaveBeenCalled();
  });

  it('leaves a notice the shade refused unacknowledged, and shows it on the next wake-up', async () => {
    const a = notice();
    const b = notice();
    const client = fakeClient([a, b]);
    present.mockImplementationOnce(async () => false);

    await handleWake(androidWake(a.id), { ensureSession: async () => true, client });
    expect(client.acked).toEqual([b.id]);

    await handleWake(androidWake(a.id), { ensureSession: async () => true, client: fakeClient([a]) });
    expect(presented).toEqual([b.id, a.id]);
  });

  it('puts the time the Pond recorded a fetched notice in the shade, and leaves the in-app list as sent', async () => {
    const a = notice({ timestamp: '2026-10-30T21:42:00Z' });
    const listed: ServerNotification[] = [];
    const stop = onDelivered((n) => listed.push(n));

    await handleWake(androidWake(a.id), { ensureSession: async () => true, client: fakeClient([a]) });
    stop();

    expect(present.mock.calls[0][0].body).toMatch(/^The back door opened · /);
    expect(listed[0].body).toBe('The back door opened');
  });

  it('survives a failed fetch, a failed session restore and a stalled Pond', async () => {
    await expect(handleWake(androidWake(), { ensureSession: async () => true, client: fakeClient(new Error('503')) }))
      .resolves.toBe('failed');
    await expect(handleWake(androidWake(), {
      ensureSession: async () => { throw new Error('keystore'); },
      client: fakeClient([]),
    })).resolves.toBe('failed');
    await expect(handleWake(androidWake(), {
      ensureSession: () => new Promise<boolean>(() => {}),
      client: fakeClient([]),
      budgetMs: 10,
    })).resolves.toBe('failed');
  });

  it('keeps going when one acknowledgement fails, and skips items that are not notices', async () => {
    const a = notice();
    const b = notice();
    const client = fakeClient([a, { id: 'broken' }, b]);
    (client.ackNotification as jest.Mock).mockImplementationOnce(async () => { throw new Error('429'); });

    await expect(handleWake(androidWake(), { ensureSession: async () => true, client })).resolves.toBe('delivered');

    expect(presented).toEqual([a.id, b.id]);
    expect(client.ackNotification).toHaveBeenCalledTimes(2);
  });
});

describe('no double display', () => {
  it('presents a notice the stream already delivered once, but still acknowledges it', async () => {
    const a = notice();
    const listed: string[] = [];
    const stop = onDelivered((n) => listed.push(n.id));

    // The stream got there first ...
    await expect(deliver(a)).resolves.toBe(true);
    // ... then the wake-up fetches the same notice from the pending list.
    const client = fakeClient([a]);
    await handleWake(androidWake(a.id), { ensureSession: async () => true, client });
    stop();

    expect(presented).toEqual([a.id]);
    expect(listed).toEqual([a.id]);
    expect(client.acked).toEqual([a.id]);
  });
});

// The stream's path. The Pond re-sends every notice the phone has not acknowledged on each
// new connection, so one already shown here is acknowledged again rather than skipped.
describe('deliverAndAcknowledge', () => {
  it('shows a new notice once and acknowledges it every time it arrives', async () => {
    const n = notice();
    const client = fakeClient([]);

    expect(await deliverAndAcknowledge(client, n, 'stream')).toEqual({ presented: true, acked: true });
    expect(await deliverAndAcknowledge(client, n, 'stream')).toEqual({ presented: false, acked: true });

    expect(presented).toEqual([n.id]);
    expect(client.acked).toEqual([n.id, n.id]);
  });
});

// The Pond records "shown" apart from "fetched": only the shade taking a notice counts.
describe('saying what was shown', () => {
  it('acknowledges a notice the shade took as shown, repeats included', async () => {
    const a = notice();
    const client = fakeClient([a]);

    await handleWake(androidWake(a.id), { ensureSession: async () => true, client });
    await handleWake(androidWake(a.id), { ensureSession: async () => true, client });

    expect((client.ackNotification as jest.Mock).mock.calls).toEqual([[a.id, true], [a.id, true]]);
  });

  it('acknowledges a notice the shade refused in the foreground without claiming it was shown', async () => {
    const a = notice();
    const client = fakeClient([a]);
    present.mockImplementationOnce(async () => false);

    await drainPending(client, 'foreground');

    expect((client.ackNotification as jest.Mock).mock.calls).toEqual([[a.id, false]]);
  });
});

// An iPhone's wake is one fixed line in the shade; the notice it stood for replaces it.
describe('the iPhone wake line', () => {
  const iosWake = (id: string) => ({
    data: { notification_id: id, category: 'info', wake: '1', dataString: null },
    notification: { title: 'Goose', body: 'Something new from your Pond.' },
    aps: { 'content-available': 1, 'mutable-content': 1 },
  });

  it('is dismissed after its notices are shown and acknowledged', async () => {
    const a = notice();
    const client = fakeClient([a]);
    mockShade.push(wakeLine('apns-collapse-1'), { request: { identifier: a.id, content: { data: { id: a.id } }, trigger: null } });

    await expect(handleWake(iosWake(a.id), { ensureSession: async () => true, client })).resolves.toBe('delivered');

    expect(presented).toEqual([a.id]);
    expect(client.acked).toEqual([a.id]);
    expect(mockDismissed).toEqual(['apns-collapse-1']);
  });

  it('is dismissed when nothing was waiting, since some other path already showed the notice', async () => {
    mockShade.push(wakeLine('apns-collapse-2'));
    await handleWake(iosWake('n-gone'), { ensureSession: async () => true, client: fakeClient([]) });
    expect(mockDismissed).toEqual(['apns-collapse-2']);
  });

  it('stays while the shade refuses a notice it stands for, and while the Pond cannot be reached', async () => {
    mockShade.push(wakeLine('apns-collapse-3'));
    present.mockImplementationOnce(async () => false);
    await handleWake(iosWake('n-1'), { ensureSession: async () => true, client: fakeClient([notice()]) });
    await handleWake(iosWake('n-1'), { ensureSession: async () => true, client: fakeClient(new Error('503')) });
    expect(mockDismissed).toEqual([]);
  });

  it('puts the notice back when the line it dismissed shared the notice\'s identifier', async () => {
    const a = notice();
    mockShade.push(wakeLine(a.id));

    await handleWake(iosWake(a.id), { ensureSession: async () => true, client: fakeClient([a]) });

    expect(mockDismissed).toEqual([a.id]);
    expect(presented).toEqual([a.id, a.id]);
  });

  it('is not looked for on Android', async () => {
    Platform.OS = 'android';
    mockShade.push(wakeLine('apns-collapse-4'));
    await handleWake(androidWake(), { ensureSession: async () => true, client: fakeClient([notice()]) });
    expect(mockDismissed).toEqual([]);
  });
});
