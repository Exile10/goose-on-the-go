import type { PondApiClient } from '@/services/api-client';
import type { ServerNotification } from '@/services/notification-stream';
import { pullPendingNotifications } from '@/services/pull-notifications';

const mockPresent = jest.fn();
jest.mock('@/services/local-notifications', () => ({
  presentLocally: (...args: unknown[]) => mockPresent(...args),
}));
// The default client is never used here; every test hands in its own.
jest.mock('@/services/api-client', () => ({ api: {} }));

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

beforeEach(() => mockPresent.mockReset());

describe('pullPendingNotifications', () => {
  it('presents each waiting notification, oldest first, and acknowledges it after', async () => {
    const { pond, events } = client([DOOR, BACK]);

    await expect(pullPendingNotifications(pond)).resolves.toBe(2);

    expect(events).toEqual([`present ${DOOR.id}`, `ack ${DOOR.id}`, `present ${BACK.id}`, `ack ${BACK.id}`]);
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
  });

  it('lets a failed read reach the caller, which decides what to show instead', async () => {
    const pond = { pendingNotifications: jest.fn().mockRejectedValue(new Error('unreachable')) } as unknown as PondApiClient;
    await expect(pullPendingNotifications(pond)).rejects.toThrow('unreachable');
    expect(mockPresent).not.toHaveBeenCalled();
  });
});
