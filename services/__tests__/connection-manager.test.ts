import { ConnectionManager } from '../connection-manager';
import { ConnectionProfile } from '@/models/connection';
const profile: ConnectionProfile = { version: 2, host: 'pond.local', port: 4443,
  localUrls: ['https://192.168.1.2:4443'], remoteUrl: 'https://100.64.0.2:4443', remoteAccess: { mode: 'embedded', controlUrl: 'https://coord.example' } };
const pin = `sha256/${'A'.repeat(43)}=`;
const fixture = () => {
  const deps = { probe: jest.fn(async (_url: string) => true), discover: jest.fn(async () => null),
    trust: jest.fn(async () => undefined), changed: jest.fn() };
  return { deps, manager: new ConnectionManager(deps) };
};
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
it('coalesces simultaneous REST and SSE recovery', async () => {
  const { deps, manager } = fixture(); await manager.configure(profile, pin);
  const first = manager.recover(); const second = manager.recover();
  expect(first).toBe(second); expect(await first).toBe(profile.localUrls[0]);
  expect(deps.probe).toHaveBeenCalledTimes(1); manager.environment(false, false);
});
it('uses tailnet on cellular and returns to LAN', async () => {
  const { deps, manager } = fixture(); await manager.configure(profile, pin);
  manager.environment(true, true); await manager.recover();
  expect(manager.current).toEqual({ state: 'remote', url: profile.remoteUrl });
  manager.environment(false, true); await manager.recover();
  expect(manager.current.state).toBe('local');
  expect(deps.probe.mock.calls).toHaveLength(2); manager.environment(false, false);
});
it('rejects an old network result after backgrounding', async () => {
  const { deps, manager } = fixture(); let finish!: (ok: boolean) => void;
  deps.probe.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await manager.configure(profile, pin); const recovery = manager.recover();
  manager.environment(false, false); finish(true); expect(await recovery).toBeNull();
  expect(manager.current.url).toBeNull();
});
it('continues after a pin-rejected candidate but never changes the pin', async () => {
  const { deps, manager } = fixture();
  deps.probe.mockRejectedValueOnce(new Error('pin mismatch'));
  await manager.configure(profile, pin); expect(await manager.recover()).toBe(profile.remoteUrl);
  expect(deps.trust).toHaveBeenCalledWith([...profile.localUrls, profile.remoteUrl], pin);
  manager.environment(false, false);
});
/**
 * Seen on the iPhone simulator on 2026-10-24: the Pond dropped at 19:45, the retries ran out at
 * 19:46, and the app said the Pond was unavailable, in front, for two hours after it was back.
 */
it('keeps checking a Pond that is down every 30 s while in front, and finds it once it is back', async () => {
  jest.useFakeTimers();
  // The jitter's midpoint, so each wait is exactly its nominal length.
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  const { deps, manager } = fixture();
  let up = false;
  const start = Date.now();
  const checks: number[] = [];
  deps.probe.mockImplementation(async (url: string) => {
    if (url === profile.localUrls[0]) checks.push((Date.now() - start) / 1000);
    return up;
  });
  await manager.configure(profile, pin); await manager.recover();
  await jest.advanceTimersByTimeAsync(31_000);
  expect(checks).toEqual([0, 1, 3, 7, 15, 31]);
  deps.changed.mockClear();

  await jest.advanceTimersByTimeAsync(269_000);
  expect(checks).toEqual([0, 1, 3, 7, 15, 31, 61, 91, 121, 151, 181, 211, 241, 271]);
  // The LAN address and the tailnet each time, and nothing more: the Pond rate-limits per IP.
  expect(deps.probe).toHaveBeenCalledTimes(28);

  up = true;
  await jest.advanceTimersByTimeAsync(30_000);
  expect(checks.at(-1)).toBe(301);
  expect(manager.current).toEqual({ state: 'local', url: profile.localUrls[0] });
  const states = deps.changed.mock.calls.map(([snapshot]: [{ state: string }]) => snapshot.state);
  expect(states).not.toContain('reconnecting');
  expect(states.at(-1)).toBe('local');
  expect(jest.getTimerCount()).toBe(0);
  manager.environment(false, false);
});

it('stops checking a Pond that is down while the app is in the background', async () => {
  jest.useFakeTimers(); const { deps, manager } = fixture(); deps.probe.mockResolvedValue(false);
  await manager.configure(profile, pin); await manager.recover();
  await jest.advanceTimersByTimeAsync(120_000);
  const probes = deps.probe.mock.calls.length;

  manager.environment(false, false);
  expect(jest.getTimerCount()).toBe(0);
  await jest.advanceTimersByTimeAsync(3_600_000);
  expect(deps.probe).toHaveBeenCalledTimes(probes);

  // Back in front, it checks at once rather than waiting out the old schedule.
  deps.probe.mockResolvedValue(true);
  manager.environment(false, true); await manager.recover();
  expect(deps.probe).toHaveBeenCalledTimes(probes + 1);
  expect(manager.current.state).toBe('local');
  manager.environment(false, false);
});
it('returns to LAN when a temporary local outage clears on the same Wi-Fi', async () => {
  jest.useFakeTimers(); const { deps, manager } = fixture();
  deps.probe.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await manager.configure(profile, pin); await manager.recover();
  expect(manager.current.state).toBe('remote');
  await jest.advanceTimersByTimeAsync(30_000);
  expect(manager.current.state).toBe('local'); manager.environment(false, false);
});

it.each([undefined, { mode: 'local' as const }])('never probes remote endpoints without saved opt-in: %s', async (remoteAccess) => {
  const { deps, manager } = fixture();
  await manager.configure({ ...profile, remoteAccess }, pin);
  manager.environment(true, true); await manager.recover();
  expect(deps.probe).not.toHaveBeenCalled();
  expect(deps.discover).not.toHaveBeenCalled();
  expect(deps.trust).toHaveBeenCalledWith(profile.localUrls, pin);
  manager.environment(false, false);
});

/**
 * The bug this reproduces, seen by unregistering the phone from the Pond's own
 * device list while the app was open: the banner alternated between "Connected
 * remotely", "Reconnecting to your Pond" and "Pond unavailable" indefinitely.
 *
 * The cause is that `probe` carries no bearer token -- it asks whether the Pond
 * is reachable, not whether it still knows this phone. So a revoked pairing
 * looks exactly like a healthy one to the recovery path, while every real
 * request keeps failing and asking it to recover again.
 */
it('stops recovering once the Pond has refused this phone, and says so', async () => {
  const { deps, manager } = fixture();
  await manager.configure(profile, pin);
  await manager.recover();
  expect(manager.current.state).toBe('local');

  manager.revoke();
  expect(manager.current.state).toBe('revoked');

  // The flicker itself: a request path and an event stream both discovering the
  // same 401 and both asking to reconnect. The probe would succeed every time.
  const probesBefore = deps.probe.mock.calls.length;
  expect(await manager.recover()).toBeNull();
  expect(await manager.recover(true)).toBeNull();
  manager.environment(false, true);
  expect(deps.probe).toHaveBeenCalledTimes(probesBefore);
  expect(manager.current.state).toBe('revoked');

  // Announced once, however many callers trip over it.
  const announcements = deps.changed.mock.calls.filter(
    ([snapshot]: [{ state: string }]) => snapshot.state === 'revoked',
  );
  expect(announcements).toHaveLength(1);

  manager.environment(false, false);
});

it('pairing again clears the refusal', async () => {
  const { deps, manager } = fixture();
  await manager.configure(profile, pin);
  manager.revoke();
  expect(manager.current.state).toBe('revoked');

  // `configure` is what pairing calls, and it is the only way back.
  await manager.configure(profile, pin);
  expect(await manager.recover()).toBe(profile.localUrls[0]);
  expect(manager.current.state).toBe('local');
  expect(deps.probe).toHaveBeenCalled();
  manager.environment(false, false);
});

it('never calls a saved pairing unpaired, even before its first probe', async () => {
  const { deps, manager } = fixture();
  await manager.configure(profile, pin);
  const states = deps.changed.mock.calls.map(([snapshot]: [{ state: string }]) => snapshot.state);
  expect(states).toEqual(['reconnecting']);
  await manager.configure(null);
  expect(manager.current.state).toBe('unpaired');
});

/**
 * Android recreates the activity on a return to the app, which remounts the provider and builds
 * a new manager. On the A57 that showed up as "unpaired", "reconnecting", then "remote" on every
 * return, each one moving the banner, for a route that had not changed.
 */
it('carries on with the route a previous manager found, and re-checks it quietly', async () => {
  const routes = new Map();
  const first = fixture();
  const before = new ConnectionManager({ ...first.deps, routes });
  await before.configure(profile, pin); await before.recover();
  expect(before.current.state).toBe('local');

  const { deps } = fixture();
  const after = new ConnectionManager({ ...deps, routes });
  await after.configure(profile, pin);
  expect(after.current).toEqual({ state: 'local', url: profile.localUrls[0] });
  after.environment(false, true); await after.recover();
  const states = deps.changed.mock.calls.map(([snapshot]: [{ state: string }]) => snapshot.state);
  expect(states).not.toContain('reconnecting');
  expect(states).not.toContain('unpaired');
  expect(deps.probe).toHaveBeenCalledWith(profile.localUrls[0]);
  after.environment(false, false); before.environment(false, false);
});

it('ignores a remembered route the profile no longer names', async () => {
  const routes = new Map();
  const first = fixture();
  const before = new ConnectionManager({ ...first.deps, routes });
  before.environment(true, true);
  await before.configure(profile, pin); await before.recover();
  expect(before.current.state).toBe('remote');

  const { deps } = fixture();
  const after = new ConnectionManager({ ...deps, routes });
  await after.configure({ ...profile, remoteAccess: { mode: 'local' } }, pin);
  expect(after.current).toEqual({ state: 'reconnecting', url: null });
  before.environment(false, false); after.environment(false, false);
});

it('forgets the remembered route once the Pond refuses this phone', async () => {
  const routes = new Map();
  const { deps } = fixture();
  const manager = new ConnectionManager({ ...deps, routes });
  await manager.configure(profile, pin); await manager.recover();
  expect(routes.size).toBe(1);
  manager.revoke();
  expect(routes.size).toBe(0);
});

it('still says so when the quiet re-check of a working route fails', async () => {
  const { deps, manager } = fixture();
  await manager.configure(profile, pin); await manager.recover();
  deps.probe.mockResolvedValue(false);
  manager.environment(false, true); await manager.recover();
  expect(manager.current.state).toBe('disconnected');
  manager.environment(false, false);
});

/**
 * Away from home on Wi-Fi the saved home address never answers, and each one held remote access
 * up for its whole three-second timeout before the tailnet was tried.
 */
it('does not let a home address that never answers hold up remote access', async () => {
  jest.useFakeTimers();
  const { deps, manager } = fixture();
  deps.probe.mockImplementation((url: string) => url === profile.remoteUrl ? Promise.resolve(true) : new Promise<boolean>(() => undefined));
  await manager.configure(profile, pin);
  const recovery = manager.recover();
  await jest.advanceTimersByTimeAsync(250);
  expect(await recovery).toBe(profile.remoteUrl);
  expect(manager.current.state).toBe('remote');
  manager.environment(false, false);
});

it('prefers the home address whenever it answers within its head start', async () => {
  jest.useFakeTimers();
  const { deps, manager } = fixture();
  deps.probe.mockImplementation((url: string) => url === profile.remoteUrl
    ? Promise.resolve(true)
    : new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 100)));
  await manager.configure(profile, pin);
  const recovery = manager.recover();
  await jest.advanceTimersByTimeAsync(100);
  expect(await recovery).toBe(profile.localUrls[0]);
  expect(deps.probe).not.toHaveBeenCalledWith(profile.remoteUrl);
  manager.environment(false, false);
});

it('tries remote alongside discovery instead of waiting for it', async () => {
  const { deps, manager } = fixture();
  deps.probe.mockImplementation(async (url: string) => url === profile.remoteUrl);
  deps.discover.mockImplementation(() => new Promise(() => undefined));
  await manager.configure(profile, pin);
  expect(await manager.recover()).toBe(profile.remoteUrl);
  expect(deps.discover).toHaveBeenCalled();
  manager.environment(false, false);
});

it('rides out a working route that drops for a moment, without announcing it', async () => {
  jest.useFakeTimers();
  const { deps, manager } = fixture();
  await manager.configure(profile, pin); await manager.recover();
  expect(manager.current.state).toBe('local');
  deps.changed.mockClear();
  // The first pass finds nothing; the route is back by the second.
  deps.probe.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
  const recovery = manager.recover(true);
  await jest.advanceTimersByTimeAsync(1_000);
  expect(await recovery).toBe(profile.localUrls[0]);
  const states = deps.changed.mock.calls.map(([snapshot]: [{ state: string }]) => snapshot.state);
  expect(states).toEqual(['local']);
  manager.environment(false, false);
});

it('gives a route that was never working no second pass', async () => {
  jest.useFakeTimers();
  const { deps, manager } = fixture();
  deps.probe.mockResolvedValue(false);
  await manager.configure(profile, pin);
  await manager.recover();
  expect(manager.current.state).toBe('disconnected');
  manager.environment(false, false);
});

/**
 * A cold start on cellular, before this phone's tailnet node has come up: every probe of the
 * tailnet address failed at once and the app said "Pond unavailable" for twelve seconds.
 */
it('waits for its own tailnet node instead of reporting the Pond unavailable', async () => {
  const { deps } = fixture();
  let ready!: (value: boolean) => void;
  const manager = new ConnectionManager({ ...deps, remoteReady: () => new Promise<boolean>((resolve) => { ready = resolve; }) });
  await manager.configure(profile, pin);
  manager.environment(true, true);
  const recovery = manager.recover();
  await Promise.resolve();
  expect(deps.probe).not.toHaveBeenCalled();
  expect(manager.current.state).toBe('reconnecting');
  ready(true);
  expect(await recovery).toBe(profile.remoteUrl);
  const states = deps.changed.mock.calls.map(([snapshot]: [{ state: string }]) => snapshot.state);
  expect(states).not.toContain('disconnected');
  manager.environment(false, false);
});

it('reports the Pond unavailable when its own node never comes up', async () => {
  const { deps } = fixture();
  const manager = new ConnectionManager({ ...deps, remoteReady: async () => false });
  await manager.configure(profile, pin);
  manager.environment(true, true);
  expect(await manager.recover()).toBeNull();
  expect(deps.probe).not.toHaveBeenCalled();
  expect(manager.current.state).toBe('disconnected');
  manager.environment(false, false);
});
