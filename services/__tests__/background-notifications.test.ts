const mockDefine = jest.fn();
const mockHandle = jest.fn();
let mockAppState = 'background';

jest.mock('expo-task-manager', () => ({ defineTask: (...a: unknown[]) => mockDefine(...a) }));
jest.mock('react-native', () => ({ AppState: { get currentState() { return mockAppState; } } }));
jest.mock('@/services/notifications-module', () => ({ notifications: null }));
jest.mock('@/services/wake-handler', () => ({ handleWakePing: (...a: unknown[]) => mockHandle(...a) }));

import type { NotificationsModule } from '@/services/notifications-module';
import { defineWakeTask, WAKE_TASK } from '@/services/background-notifications';

const RESULT = { NewData: 0, NoData: 1, Failed: 2 };
const PING = { data: { wake: '1', notification_id: 'n-1:phone-a', category: 'alert' } };

function define() {
  const registerTaskAsync = jest.fn().mockResolvedValue(null);
  defineWakeTask({ BackgroundNotificationTaskResult: RESULT, registerTaskAsync } as unknown as NotificationsModule);
  const task = mockDefine.mock.calls[0][1] as (body: { data: unknown }) => Promise<number>;
  return { task, registerTaskAsync };
}

beforeEach(() => {
  mockDefine.mockClear();
  mockHandle.mockReset();
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
  ])('handles a wake ping in the background and reports %s to the OS', async (outcome, expected) => {
    mockHandle.mockResolvedValue(outcome);
    const { task } = define();
    await expect(task({ data: PING })).resolves.toBe(expected);
    expect(mockHandle).toHaveBeenCalledWith({ notificationId: 'n-1:phone-a', category: 'alert' });
  });

  it('leaves a ping to the open stream while the app is in use', async () => {
    mockAppState = 'active';
    const { task } = define();
    await expect(task({ data: PING })).resolves.toBe(RESULT.NoData);
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it('ignores anything that is not a wake ping', async () => {
    const { task } = define();
    await expect(task({ data: { actionIdentifier: 'default' } })).resolves.toBe(RESULT.NoData);
    expect(mockHandle).not.toHaveBeenCalled();
  });
});
