import type { PondApiClient } from '@/services/api-client';
import { handleWakePing, standIn } from '@/services/wake-handler';

const mockPull = jest.fn();
jest.mock('@/services/pull-notifications', () => ({ pullPendingNotifications: (...a: unknown[]) => mockPull(...a) }));
const mockPresent = jest.fn().mockResolvedValue(true);
jest.mock('@/services/local-notifications', () => ({ presentLocally: (...a: unknown[]) => mockPresent(...a) }));
jest.mock('@/services/background-pond', () => ({ pondForBackground: jest.fn() }));

const PING = { notificationId: 'n-1:phone-a', category: 'alert' };
const POND = {} as PondApiClient;

beforeEach(() => {
  mockPull.mockReset();
  mockPresent.mockClear();
});

describe('handleWakePing', () => {
  it('pulls from the Pond it reached', async () => {
    mockPull.mockResolvedValue(1);
    await expect(handleWakePing(PING, async () => POND)).resolves.toBe('pulled');
    expect(mockPull).toHaveBeenCalledWith(POND);
  });

  it('reports nothing waiting when the stream got there first', async () => {
    mockPull.mockResolvedValue(0);
    await expect(handleWakePing(PING, async () => POND)).resolves.toBe('nothing');
  });

  it('reports the Pond unreachable when no address answers, and shows a stand-in under the alert’s id', async () => {
    await expect(handleWakePing(PING, async () => null)).resolves.toBe('unreachable');
    expect(mockPull).not.toHaveBeenCalled();
    expect(mockPresent).toHaveBeenCalledTimes(1);
    expect(mockPresent.mock.calls[0][0]).toMatchObject({ id: 'n-1:phone-a', category: 'alert' });
  });

  it('shows no stand-in over the line an iPhone already drew for the wake', async () => {
    await expect(handleWakePing({ ...PING, visible: true }, async () => null)).resolves.toBe('unreachable');
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('shows no stand-in when the alert itself was shown, or nothing was waiting', async () => {
    mockPull.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await handleWakePing(PING, async () => POND);
    await handleWakePing(PING, async () => POND);
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('reports the Pond unreachable rather than throwing when the pull fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockPull.mockRejectedValue(new Error('timeout'));
    await expect(handleWakePing(PING, async () => POND)).resolves.toBe('unreachable');
    warn.mockRestore();
  });
});

describe('standIn', () => {
  it('says only that something happened, more urgently for an alert', () => {
    const alert = standIn(PING);
    const update = standIn({ ...PING, category: 'info' });
    expect(alert.title).toBe('Alert from your Pond');
    expect(update.title).toBe('Update from your Pond');
    expect(alert.body).toBe(update.body);
    expect(alert.data).toBeUndefined();
  });
});
