// What the connection manager tells the screens about an outage -- failed checks, why, the next
// check, the last answer -- its back-off, and an address the Pond was heard announcing.
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

describe('what an outage tells the screens', () => {
  const localOnly: ConnectionProfile = { version: 2, host: 'pond.local', port: 4443, localUrls: ['https://192.168.1.2:4443'] };
  /** The wait before each automatic check, in seconds, as published with each failure. */
  const waits = (deps: ReturnType<typeof fixture>['deps']) => {
    const seen: number[] = [];
    deps.changed.mockImplementation((snapshot: { state: string; outage?: { nextCheckAt: number | null } }) => {
      if (snapshot.state === 'disconnected' && snapshot.outage?.nextCheckAt) seen.push((snapshot.outage.nextCheckAt - Date.now()) / 1000);
    });
    return seen;
  };
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  it('says how many checks failed, why, and when the next runs', async () => {
    const { deps, manager } = fixture(); deps.probe.mockResolvedValue(false);
    await manager.configure(profile, pin); await manager.recover();
    expect(manager.current).toEqual({ state: 'disconnected', url: null, outage: {
      failures: 1, reason: 'local_and_remote', nextCheckAt: Date.now() + 1_000, lastConnectedAt: null,
    } });
    expect(console.info).toHaveBeenCalledWith('[connection] next check scheduled', expect.objectContaining({
      kind: 'route_retry_scheduled', reason: 'local_and_remote', failures: 1, inMs: 1_000,
    }));
    manager.environment(false, false);
  });

  it('says outside access is not set up when mobile data has nothing to try', async () => {
    const { deps, manager } = fixture(); deps.probe.mockResolvedValue(false);
    await manager.configure(localOnly, pin); manager.environment(true, true); await manager.recover();
    expect(deps.probe).not.toHaveBeenCalled();
    expect(manager.current.outage?.reason).toBe('remote_off');
    manager.environment(false, false);
  });

  it('backs off 1, 2, 4, 8 and 16 s, then checks every 30 s, never faster', async () => {
    const { deps, manager } = fixture(); deps.probe.mockResolvedValue(false);
    const seen = waits(deps);
    await manager.configure(localOnly, pin); await manager.recover();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(seen).toEqual([1, 2, 4, 8, 16, 30, 30, 30]);
    expect(manager.current.outage?.failures).toBe(8);
    manager.environment(false, false);
  });

  it.each([
    ['the network changes', (m: ConnectionManager) => m.environment(true, true)],
    ['the app comes back to the front', (m: ConnectionManager) => { m.environment(false, false); m.environment(false, true); }],
    ['someone taps Try now', (m: ConnectionManager) => void m.retryNow()],
  ])('checks at once and starts the back-off again when %s', async (_, trigger) => {
    const { deps, manager } = fixture(); deps.probe.mockResolvedValue(false);
    const seen = waits(deps);
    await manager.configure(profile, pin); await manager.recover();
    await jest.advanceTimersByTimeAsync(14_000);
    expect(seen).toEqual([1, 2, 4, 8]);
    const probes = deps.probe.mock.calls.length;

    trigger(manager);
    await jest.advanceTimersByTimeAsync(0);
    expect(deps.probe.mock.calls.length).toBeGreaterThan(probes);
    expect(seen.at(-1)).toBe(1);
    // The outage itself goes on: the count is of checks since the Pond last answered.
    expect(manager.current.outage?.failures).toBe(5);
    manager.environment(false, false);
  });

  it('remembers when a working route was last seen, and clears the outage once the Pond answers', async () => {
    const { deps, manager } = fixture();
    await manager.configure(localOnly, pin); await manager.recover();
    expect(manager.current.state).toBe('local');
    const dropped = Date.now();
    deps.probe.mockResolvedValue(false);
    // A route that was working gets its second pass a second later.
    const check = manager.retryNow();
    await jest.advanceTimersByTimeAsync(1_000);
    await check;
    expect(manager.current.outage).toMatchObject({ failures: 1, reason: 'local', lastConnectedAt: dropped });

    deps.probe.mockResolvedValue(true);
    await manager.retryNow();
    expect(manager.current).toEqual({ state: 'local', url: localOnly.localUrls[0] });
    expect(console.info).toHaveBeenCalledWith('[connection] reached after failed checks', { kind: 'route_recovered', route: 'local', failures: 1 });
    manager.environment(false, false);
  });
});

describe('an address the Pond was heard announcing', () => {
  const moved = 'https://192.168.1.23:4443';
  beforeEach(() => { jest.spyOn(console, 'info').mockImplementation(() => undefined); });

  it('is checked under the saved pin and kept once it answers', async () => {
    const { deps, manager } = fixture();
    deps.probe.mockImplementation(async (url: string) => url === moved);
    await manager.configure({ ...profile, remoteAccess: { mode: 'local' }, remoteUrl: undefined }, pin);
    expect(await manager.tryAddress(moved)).toBe(moved);
    expect(deps.trust).toHaveBeenLastCalledWith([...profile.localUrls, moved], pin);
    expect(deps.discover).not.toHaveBeenCalled();
    expect(manager.current).toEqual({ state: 'local', url: moved });
    expect(manager.savedProfile?.localUrls[0]).toBe(moved);
    manager.environment(false, false);
  });

  it('is not kept when nothing there answers under the pin', async () => {
    const { deps, manager } = fixture();
    deps.probe.mockResolvedValue(false);
    await manager.configure({ ...profile, remoteAccess: { mode: 'local' }, remoteUrl: undefined }, pin);
    expect(await manager.tryAddress(moved)).toBeNull();
    expect(manager.savedProfile?.localUrls).toEqual(profile.localUrls);
    expect(manager.current.state).toBe('disconnected');
    manager.environment(false, false);
  });
});
