import { ConnectionManager } from '../connection-manager';
import { ConnectionProfile } from '@/models/connection';
const profile: ConnectionProfile = { version: 2, host: 'pond.local', port: 4443,
  localUrls: ['https://192.168.1.2:4443'], remoteUrl: 'https://100.64.0.2:4443', remoteAccess: { mode: 'embedded', controlUrl: 'https://coord.example' } };
const pin = `sha256/${'A'.repeat(43)}=`;
const fixture = () => {
  const deps = { probe: jest.fn(async () => true), discover: jest.fn(async () => null),
    trust: jest.fn(async () => undefined), changed: jest.fn() };
  return { deps, manager: new ConnectionManager(deps) };
};
afterEach(() => jest.useRealTimers());
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
it('bounds failed recovery and pauses all timers in the background', async () => {
  jest.useFakeTimers(); const { deps, manager } = fixture(); deps.probe.mockResolvedValue(false);
  await manager.configure(profile, pin); await manager.recover();
  await jest.advanceTimersByTimeAsync(300_000);
  expect(deps.probe).toHaveBeenCalledTimes(12);
  manager.environment(false, false); expect(jest.getTimerCount()).toBe(0);
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
