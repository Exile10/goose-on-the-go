import type { PondApiClient } from '@/services/api-client';
import { handleWakePing } from '@/services/wake-handler';

const mockPull = jest.fn();
jest.mock('@/services/pull-notifications', () => ({ pullPendingNotifications: (...a: unknown[]) => mockPull(...a) }));
jest.mock('@/services/background-pond', () => ({ pondForBackground: jest.fn() }));

const PING = { notificationId: 'n-1:phone-a', category: 'alert' };
const POND = {} as PondApiClient;

beforeEach(() => mockPull.mockReset());

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

  it('reports the Pond unreachable when no address answers', async () => {
    await expect(handleWakePing(PING, async () => null)).resolves.toBe('unreachable');
    expect(mockPull).not.toHaveBeenCalled();
  });

  it('reports the Pond unreachable rather than throwing when the pull fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockPull.mockRejectedValue(new Error('timeout'));
    await expect(handleWakePing(PING, async () => POND)).resolves.toBe('unreachable');
    warn.mockRestore();
  });
});
