const mockDefine = jest.fn();
const mockHandle = jest.fn();
const mockWake = jest.fn();
const mockDelivered = jest.fn();
let mockAppState = 'background';

jest.mock('expo-task-manager', () => ({ defineTask: (...a: unknown[]) => mockDefine(...a) }));
jest.mock('react-native', () => ({
  AppState: { get currentState() { return mockAppState; } },
  Platform: { OS: 'ios' },
}));
jest.mock('@/services/notifications-module', () => ({ notifications: null }));
jest.mock('@/services/wake-handler', () => ({ handleWakePing: (...a: unknown[]) => mockHandle(...a) }));
jest.mock('@/services/notification-wake', () => ({ handleWake: (...a: unknown[]) => mockWake(...a) }));
jest.mock('@/services/notification-delivery', () => ({ alreadyDelivered: (id: string) => mockDelivered(id) }));
jest.mock('@/services/pond-session', () => ({ ensurePondSession: jest.fn() }));
jest.mock('@/services/api-client', () => ({ api: {} }));

import type { NotificationsModule } from '@/services/notifications-module';
import { defineWakeTask, WAKE_TASK } from '@/services/background-notifications';

const RESULT = { NewData: 0, NoData: 1, Failed: 2 };
const PING = { data: { wake: '1', notification_id: 'n-1:phone-a', category: 'alert' } };

function define() {
  const registerTaskAsync = jest.fn().mockResolvedValue(null);
  defineWakeTask({ BackgroundNotificationTaskResult: RESULT, registerTaskAsync } as unknown as NotificationsModule);
  const task = mockDefine.mock.calls[0][1] as (body: { data: unknown; error?: Error | null }) => Promise<number>;
  return { task, registerTaskAsync };
}

beforeEach(() => {
  mockDefine.mockClear();
  mockHandle.mockReset();
  mockWake.mockReset().mockResolvedValue('unpaired');
  mockDelivered.mockReset().mockReturnValue(false);
  mockAppState = 'background';
});

describe('defineWakeTask', () => {
  it('defines the task and registers it for remote notifications', () => {
    const { registerTaskAsync } = define();
    expect(mockDefine).toHaveBeenCalledWith(WAKE_TASK, expect.any(Function));
    expect(registerTaskAsync).toHaveBeenCalledWith(WAKE_TASK);
  });

  it('does nothing where there is no notifications module', () => {
    defineWakeTask(null);
    expect(mockDefine).not.toHaveBeenCalled();
  });

  it.each([
    ['pulled', RESULT.NewData],
    ['nothing', RESULT.NoData],
    ['unreachable', RESULT.Failed],
  ])('handles a wake ping the restored session could not, and reports %s to the OS', async (outcome, expected) => {
    mockHandle.mockResolvedValue(outcome);
    const { task } = define();
    await expect(task({ data: PING })).resolves.toBe(expected);
    expect(mockHandle).toHaveBeenCalledWith({ notificationId: 'n-1:phone-a', category: 'alert' });
  });

  it('reports what the restored session delivered without pulling a second time', async () => {
    mockWake.mockResolvedValue('delivered');
    const { task } = define();
    await expect(task({ data: PING })).resolves.toBe(RESULT.NewData);
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it('shows no stand-in over an alert a pass that ran out of time already showed', async () => {
    mockWake.mockResolvedValue('failed');
    mockDelivered.mockReturnValue(true);
    const { task } = define();
    await expect(task({ data: PING })).resolves.toBe(RESULT.NewData);
    expect(mockDelivered).toHaveBeenCalledWith('n-1:phone-a');
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it('leaves a ping to the open stream while the app is in use', async () => {
    mockAppState = 'active';
    const { task } = define();
    await expect(task({ data: PING })).resolves.toBe(RESULT.NoData);
    expect(mockWake).not.toHaveBeenCalled();
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it('ignores anything that is not a wake ping', async () => {
    mockWake.mockResolvedValue('ignored');
    const { task } = define();
    await expect(task({ data: { actionIdentifier: 'default' } })).resolves.toBe(RESULT.NoData);
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it('reports the restored session’s outcome for a wake-up the ping reader cannot read', async () => {
    const { task } = define();
    const topLevel = { data: { wake: '1' } };
    await expect(task({ data: topLevel })).resolves.toBe(RESULT.NoData);
    mockWake.mockResolvedValue('failed');
    await expect(task({ data: topLevel })).resolves.toBe(RESULT.Failed);
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it('reports a task the OS ran with an error as failed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { task } = define();
    await expect(task({ data: PING, error: new Error('no data') })).resolves.toBe(RESULT.Failed);
    expect(mockWake).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
