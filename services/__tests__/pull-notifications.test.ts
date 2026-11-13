import type { PondApiClient } from '@/services/api-client';
import type { ServerNotification } from '@/services/notification-stream';
import { pullPendingNotifications, withEventTime } from '@/services/pull-notifications';

const mockPresent = jest.fn();
jest.mock('@/services/local-notifications', () => ({
  presentLocally: (...args: unknown[]) => mockPresent(...args),
}));
// The default client is never used here; every test hands in its own.
jest.mock('@/services/api-client', () => ({ api: {} }));
const mockDismiss = jest.fn().mockResolvedValue(0);
jest.mock('@/services/wake-alert', () => ({ dismissWakeAlerts: (...args: unknown[]) => mockDismiss(...args) }));

const DOOR: ServerNotification = {
  id: 'n-1:phone-a', target: 'phone-a', category: 'alert',
  title: 'Front door opened', body: 'Hallway', timestamp: '2026-10-30T21:42:00Z',
};
const BACK: ServerNotification = { ...DOOR, id: 'n-2:phone-a', title: 'Back door opened', body: 'Kitchen' };

function client(pending: ServerNotification[], ack = jest.fn().mockResolvedValue(undefined)) {
  const events: string[] = [];
  mockPresent.mockImplementation(async (n: ServerNotification) => { events.push(`present ${n.id}`); return true; });
  ack.mockImplementation(async (id: string) => { events.push(`ack ${id}`); });
  const pond = {
    pendingNotifications: jest.fn().mockResolvedValue(pending),
    acknowledgeNotification: ack,
  } as unknown as PondApiClient;
  return { pond, events, ack };
}

beforeEach(() => {
  mockPresent.mockReset();
  mockDismiss.mockClear();
});

describe('pullPendingNotifications', () => {
  it('presents each waiting notification, oldest first, and acknowledges it after', async () => {
    const { pond, events } = client([DOOR, BACK]);

    await expect(pullPendingNotifications(pond)).resolves.toBe(2);

    expect(events).toEqual([`present ${DOOR.id}`, `ack ${DOOR.id}`, `present ${BACK.id}`, `ack ${BACK.id}`]);
  });

  it('tells the Pond each one was shown, and clears the iPhone wake line once all of them are', async () => {
    const { pond, ack } = client([DOOR, BACK]);

    await pullPendingNotifications(pond);

    expect(ack.mock.calls).toEqual([[DOOR.id, true], [BACK.id, true]]);
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect((mockDismiss.mock.calls[0][0] as ServerNotification[]).map((n) => n.id)).toEqual([DOOR.id, BACK.id]);
  });

  it('does nothing when nothing is waiting', async () => {
    const { pond, events } = client([]);
    await expect(pullPendingNotifications(pond)).resolves.toBe(0);
    expect(events).toEqual([]);
  });

  it('carries on past an acknowledgement the Pond refused', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { pond, ack, events } = client([DOOR, BACK]);
    ack.mockImplementationOnce(async () => { throw new Error('offline'); });

    await expect(pullPendingNotifications(pond)).resolves.toBe(2);

    expect(events).toContain(`present ${BACK.id}`);
    warn.mockRestore();
  });

  it('leaves one that never reached the shade unacknowledged, to be pulled again', async () => {
    const { pond, events } = client([DOOR, BACK]);
    mockPresent.mockImplementationOnce(async () => false);

    await expect(pullPendingNotifications(pond)).resolves.toBe(1);

    expect(events).toEqual([`present ${BACK.id}`, `ack ${BACK.id}`]);
    // The wake line still stands for the one that was not shown.
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('lets a failed read reach the caller, which decides what to show instead', async () => {
    const pond = { pendingNotifications: jest.fn().mockRejectedValue(new Error('unreachable')) } as unknown as PondApiClient;
    await expect(pullPendingNotifications(pond)).rejects.toThrow('unreachable');
    expect(mockPresent).not.toHaveBeenCalled();
  });
});

describe('withEventTime', () => {
  const at = new Date(DOOR.timestamp);
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  it('adds the time the Pond saw it, after the room', () => {
    expect(withEventTime(DOOR, new Date(at.getTime() + 60_000)).body).toBe(`Hallway · ${time}`);
  });

  it('adds the date too once it is from another day', () => {
    const body = withEventTime(DOOR, new Date(at.getTime() + 3 * 86_400_000)).body;
    expect(body).toBe(`Hallway · ${at.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`);
    expect(body).not.toBe(`Hallway · ${time}`);
  });

  it('is the whole text when the Pond sent none', () => {
    expect(withEventTime({ ...DOOR, body: '' }, at).body).toBe(time);
  });

  it('leaves the text alone when the time cannot be read', () => {
    expect(withEventTime({ ...DOOR, timestamp: 'soon' })).toEqual({ ...DOOR, timestamp: 'soon' });
  });

  it('is what reaches the shade for a pulled alert', async () => {
    const { pond } = client([DOOR]);
    await pullPendingNotifications(pond);
    expect(mockPresent.mock.calls[0][0].body).toMatch(/^Hallway · /);
  });
});
