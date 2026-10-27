/**
 * Regression tests for push-token registration.
 *
 * The bug these exist for: `watchPushTokenRotation`'s listener used to call
 * `registerPushToken`, which calls `getDevicePushTokenAsync` — and that emits
 * to the very listener that called it. The two drove each other in an
 * unbounded loop, which spent the Pond's whole per-IP rate-limit budget and
 * locked the device out of pairing. `listener_never_fetches_its_own_token` is
 * the guard; the rest cover the backoff and dedupe added alongside it.
 */

import { ApiError } from '@/services/api-client';

const mockRequest = jest.fn();
const mockGetDevicePushToken = jest.fn();
const mockAddPushTokenListener = jest.fn();
const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();

jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { request: (...args: unknown[]) => mockRequest(...args) } };
});

// The api client draws pairing randomness from expo-crypto, which needs the real
// react-native this suite stubs out below. Nothing here pairs.
jest.mock('@/services/secure-random', () => ({ randomBytes: jest.fn() }));

jest.mock('@/services/install-id', () => ({
  getInstallId: jest.fn(async () => 'install-1'),
}));

jest.mock('expo-device', () => ({ isDevice: true }));

// The module comes through notifications-module.ts, which decides whether it can be
// loaded at all; this file tests what push-token does with it once it is.
jest.mock('@/services/notifications-module', () => ({
  notifications: {
    getDevicePushTokenAsync: (...args: unknown[]) => mockGetDevicePushToken(...args),
    addPushTokenListener: (...args: unknown[]) => mockAddPushTokenListener(...args),
    getPermissionsAsync: (...args: unknown[]) => mockGetPermissions(...args),
    requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...args),
  },
}));

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

/**
 * Load a fresh copy of the module. It keeps the last-registered token in
 * module scope, so tests must not share an instance.
 */
function loadModule() {
  let mod!: typeof import('@/services/push-token');
  jest.isolateModules(() => {
    mod = require('@/services/push-token');
  });
  return mod;
}

/** The callback handed to `addPushTokenListener` by `watchPushTokenRotation`. */
type TokenListener = (event: { data: unknown; type: string }) => void;

/**
 * Drain pending microtasks. The listener deliberately does not return its
 * promise (nothing awaits an event handler), so tests have to let the upload
 * settle before asserting — and before the suite ends, or its logging lands
 * after teardown.
 */
async function flushAsync() {
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
  mockRequest.mockResolvedValue({ ok: true });
  mockGetDevicePushToken.mockResolvedValue({ data: 'token-abc', type: 'android' });
  mockAddPushTokenListener.mockReturnValue({ remove: jest.fn() });
});

describe('registerPushToken', () => {
  it('posts the native token to the paired server', async () => {
    const { registerPushToken } = loadModule();

    await expect(registerPushToken()).resolves.toBe('token-abc');

    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [path, init] = mockRequest.mock.calls[0];
    expect(path).toBe('/api/v1/devices/install-1/push-token');
    expect(JSON.parse(init.body)).toEqual({ token: 'token-abc', platform: 'fcm' });
  });

  it('returns null without posting when permission is denied', async () => {
    mockGetPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
    const { registerPushToken } = loadModule();

    await expect(registerPushToken()).resolves.toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  /**
   * The sequential guard above is not enough on its own.
   *
   * NotificationsProvider hydrates serverUrl and token as two separate state
   * updates, so its effect runs twice at mount and both calls are in flight
   * before either has finished. `lastRegistered` is still null when the second
   * one reads it, so a check-then-act guard lets both through — which is
   * exactly what a real device does: two POSTs, 51ms apart, same token.
   */
  it('posts once when two callers race at startup', async () => {
    const { registerPushToken } = loadModule();

    await Promise.all([registerPushToken(), registerPushToken()]);

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  /**
   * `NotificationsProvider` re-runs this whenever the session token changes, so
   * every silent refresh used to re-POST an unchanged native token against the
   * rate-limited endpoint. The rotation listener already guarded against that;
   * this path did not, and it shares the same per-IP budget.
   */
  it('does not re-post a token it has already registered', async () => {
    const { registerPushToken } = loadModule();

    await expect(registerPushToken()).resolves.toBe('token-abc');
    expect(mockRequest).toHaveBeenCalledTimes(1);

    // Same native token, second call — e.g. after a session-token refresh.
    await expect(registerPushToken()).resolves.toBe('token-abc');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

describe('forgetPushRegistration', () => {
  // A sign-out followed by pairing another Pond, in the same process: the native token has not
  // changed, and without this the new Pond was never sent it.
  it('lets the next Pond be sent the same token', async () => {
    const { registerPushToken, forgetPushRegistration } = loadModule();

    await registerPushToken();
    expect(mockRequest).toHaveBeenCalledTimes(1);

    forgetPushRegistration();
    await expect(registerPushToken()).resolves.toBe('token-abc');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });
});

describe('watchPushTokenRotation', () => {
  /**
   * THE regression. `getDevicePushTokenAsync` emits to this listener, so a
   * listener that calls it re-triggers itself forever. expo-notifications
   * documents the hazard on `addPushTokenListener`; this asserts we heed it.
   */
  it('never fetches its own token, which is what caused the loop', async () => {
    const { watchPushTokenRotation } = loadModule();
    watchPushTokenRotation();
    const listener: TokenListener = mockAddPushTokenListener.mock.calls[0][0];

    listener({ data: 'rotated-token', type: 'android' });
    await flushAsync();

    expect(mockGetDevicePushToken).not.toHaveBeenCalled();
    // It still did its job, using the token the event carried.
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockRequest.mock.calls[0][1].body).token).toBe('rotated-token');
  });

  it('does not re-post a token it has already registered', async () => {
    const { registerPushToken, watchPushTokenRotation } = loadModule();
    await registerPushToken(); // registers 'token-abc'
    expect(mockRequest).toHaveBeenCalledTimes(1);

    watchPushTokenRotation();
    const listener: TokenListener = mockAddPushTokenListener.mock.calls[0][0];
    listener({ data: 'token-abc', type: 'android' });
    await flushAsync();

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('posts again when the token genuinely rotates', async () => {
    const { registerPushToken, watchPushTokenRotation } = loadModule();
    await registerPushToken();

    watchPushTokenRotation();
    const listener: TokenListener = mockAddPushTokenListener.mock.calls[0][0];
    listener({ data: 'a-different-token', type: 'android' });
    await flushAsync();

    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockRequest.mock.calls[1][1].body).token).toBe('a-different-token');
  });
});

describe('retry policy', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('retries a 429 and succeeds', async () => {
    mockRequest
      .mockRejectedValueOnce(new ApiError('POST → 429', 429, 1))
      .mockResolvedValueOnce({ ok: true });
    const { registerPushToken } = loadModule();

    const result = registerPushToken();
    await jest.advanceTimersByTimeAsync(60_000);

    await expect(result).resolves.toBe('token-abc');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  /**
   * A 400 means the request itself is wrong (unknown device, malformed
   * token). Repeating it cannot help and only spends the shared per-IP
   * budget — the exact resource the loop exhausted.
   */
  it('gives up immediately on a non-retryable 4xx', async () => {
    mockRequest.mockRejectedValue(new ApiError('POST → 400', 400, null));
    const { registerPushToken } = loadModule();

    const result = registerPushToken();
    await jest.advanceTimersByTimeAsync(120_000);

    await expect(result).resolves.toBeNull();
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  /** Retries must be bounded — an unbounded retry is the bug in another form. */
  it('stops after a capped number of attempts', async () => {
    mockRequest.mockRejectedValue(new ApiError('POST → 503', 503, null));
    const { registerPushToken } = loadModule();

    const result = registerPushToken();
    await jest.advanceTimersByTimeAsync(600_000);

    await expect(result).resolves.toBeNull();
    expect(mockRequest).toHaveBeenCalledTimes(5);
  });

  it('waits at least as long as the server asked', async () => {
    mockRequest
      .mockRejectedValueOnce(new ApiError('POST → 429', 429, 30))
      .mockResolvedValueOnce({ ok: true });
    const { registerPushToken } = loadModule();

    const result = registerPushToken();

    // Well past our own backoff for attempt 1, but short of the server's ask.
    await jest.advanceTimersByTimeAsync(5_000);
    expect(mockRequest).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(26_000);
    await expect(result).resolves.toBe('token-abc');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });
});
