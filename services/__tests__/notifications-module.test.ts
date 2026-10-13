// What made Expo Go show nothing but an error: importing expo-notifications there throws.
describe('loading expo-notifications', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  function loadIn(environment: string) {
    const required = jest.fn(() => ({ marker: 'expo-notifications' }));
    let notifications: unknown;
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: { executionEnvironment: environment },
        ExecutionEnvironment: { StoreClient: 'storeClient', Bare: 'bare', Standalone: 'standalone' },
      }));
      jest.doMock('expo-notifications', required);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ({ notifications } = require('@/services/notifications-module'));
    });
    return { notifications, required };
  }

  it('is never loaded in Expo Go, and says so', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { notifications, required } = loadIn('storeClient');
    expect(notifications).toBeNull();
    expect(required).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unavailable in Expo Go'));
  });

  it.each(['bare', 'standalone'])('is loaded in a %s build', (environment) => {
    const { notifications, required } = loadIn(environment);
    expect(required).toHaveBeenCalled();
    expect(notifications).toEqual({ marker: 'expo-notifications' });
  });
});
