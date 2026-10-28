import { PondTrustError } from './pond-trust';
/** Shared, bounded endpoint selection for REST and foreground SSE. */
import type { ConnectionProfile, ConnectionState } from '@/models/connection';
import { normalizeHttpsUrl, isLocalPairingUrl } from '@/models/connection';

export interface ConnectionSnapshot { state: ConnectionState; url: string | null }
export interface ConnectionDependencies {
  probe: (url: string) => Promise<boolean>;
  discover: (host: string, port: number) => Promise<string | null>;
  trust: (urls: string[], pin: string) => Promise<void>;
  changed: (snapshot: ConnectionSnapshot) => void;
  /**
   * The last route that worked for each Pond, owned by the caller so it can outlive this manager.
   * Android recreates the activity on a return to the app and React builds a new manager with it;
   * starting from nothing then meant a reconnect, and a banner pushing every screen down, for a
   * route that had not changed. A hint only: used when the profile still lists the URL, and
   * re-checked straight away.
   */
  routes?: Map<string, ConnectionSnapshot>;
  /**
   * Resolves once this phone's own tailnet node can carry a request, or false when it will not
   * soon. Until then a probe of the tailnet address can only fail. Omitted, the probe decides.
   */
  remoteReady?: (abandoned: () => boolean) => Promise<boolean>;
}

/**
 * How long local endpoints get to answer before the tailnet is tried alongside them, the
 * head start RFC 8305 gives IPv6. Local still wins whenever it answers first; this only stops a
 * home address that never answers -- on any Wi-Fi but the home one -- from holding up remote
 * access for its whole three-second timeout, once per saved address.
 */
const LOCAL_HEAD_START_MS = 250;

/**
 * The pause before a route that was working is checked once more, rather than its first failure
 * being announced. On cellular the tailnet path drops for about a second now and then -- seen on
 * the A57 on 2026-10-05 as a request failing instantly and the retry a second later succeeding --
 * and each of those showed "Pond unavailable" and failed a refresh for nothing.
 */
const SECOND_CHANCE_MS = 1_000;

type Route = { state: 'local' | 'remote'; url: string; discovered?: boolean };

export class ConnectionManager {
  private profile: ConnectionProfile | null = null;
  private pin = '';
  private generation = 0;
  private active = true;
  private cellular = false;
  private flight: Promise<string | null> | null = null;
  private retryAfter = 0;
  private attempts = 0;
  private localRechecks = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private snapshot: ConnectionSnapshot = { state: 'unpaired', url: null };
  /**
   * Set once the Pond has refused this phone's credentials outright. It stops
   * `recover` doing anything at all, because what it does -- probe endpoints
   * without a bearer token -- cannot distinguish a Pond that has forgotten this
   * phone from one that is working perfectly. Cleared only by `configure`,
   * which is what pairing again calls.
   */
  private revoked = false;
  constructor(private readonly deps: ConnectionDependencies) {}
  private routeKey(): string | null {
    return this.profile ? `${this.pin}|${this.profile.host}:${this.profile.port}` : null;
  }
  private publish(state: ConnectionState, url: string | null = null) {
    this.snapshot = { state, url };
    const key = this.routeKey();
    if (key && this.deps.routes) {
      if ((state === 'local' || state === 'remote') && url) this.deps.routes.set(key, this.snapshot);
      else if (state === 'disconnected' || state === 'trust' || state === 'revoked') this.deps.routes.delete(key);
    }
    this.deps.changed(this.snapshot);
  }
  /** The remembered route for this profile, if the profile still names its URL. */
  private rememberedRoute(profile: ConnectionProfile): ConnectionSnapshot | null {
    const key = this.routeKey();
    const route = key ? this.deps.routes?.get(key) : undefined;
    if (!route?.url) return null;
    if (route.state === 'local' && profile.localUrls.includes(route.url)) return route;
    if (route.state === 'remote' && profile.remoteAccess?.mode === 'embedded' && profile.remoteUrl === route.url) return route;
    return null;
  }
  get current(): ConnectionSnapshot { return this.snapshot; }
  get savedProfile(): ConnectionProfile | null { return this.profile; }
  async configure(profile: ConnectionProfile | null, pin = '', upgrade = false): Promise<void> {
    this.clearTimer();
    this.generation++; this.flight = null; this.retryAfter = 0; this.attempts = 0; this.localRechecks = 0;
    this.revoked = false;
    this.profile = profile; this.pin = pin;
    // A saved pairing is never "unpaired", even for the moment before its first probe.
    const remembered = profile ? this.rememberedRoute(profile) : null;
    if (remembered) this.publish(remembered.state, remembered.url);
    else this.publish(profile ? 'reconnecting' : upgrade ? 'upgrade' : 'unpaired');
    await this.deps.trust(profile ? [...profile.localUrls, ...(profile.remoteAccess?.mode === 'embedded' && profile.remoteUrl ? [profile.remoteUrl] : [])] : [], pin);
  }
  /**
   * The Pond answered, and said it does not know this phone: its session token
   * was refused and the refresh token could not replace it. Terminal until
   * `configure` runs again.
   *
   * Announced once. Repeat calls are ignored rather than republished, because
   * the callers are a request path and an event stream that will both keep
   * hitting the same 401 and would otherwise take turns redrawing the banner.
   */
  revoke(): void {
    if (this.revoked) return;
    this.clearTimer();
    this.generation++; this.flight = null;
    this.revoked = true;
    this.publish('revoked');
  }

  environment(cellular: boolean, active: boolean): void {
    this.cellular = cellular; this.active = active;
    this.clearTimer();
    this.generation++; this.flight = null; this.retryAfter = 0; this.attempts = 0; this.localRechecks = 0;
    if (!active || this.revoked) return;
    // A route that was working stays on screen while it is re-checked; only a failed check is news.
    void this.recover(this.snapshot.state === 'local' || this.snapshot.state === 'remote');
  }
  /**
   * Re-select an endpoint now, for someone who asked: a pull to refresh, or the screen reader's
   * action on the connection strip. The automatic back-off stops recovery from hammering a Pond
   * that is down, but a person pulling expects an attempt, so this clears the wait and starts the
   * retry count afresh. An attempt already in flight is shared, as with `recover`.
   */
  retryNow = (): Promise<string | null> => {
    if (!this.flight) { this.retryAfter = 0; this.attempts = 0; }
    return this.recover();
  };
  recover = (quiet = false): Promise<string | null> => {
    if (!this.active || !this.profile || this.revoked) return Promise.resolve(null);
    if (this.flight) return this.flight;
    if (Date.now() < this.retryAfter) return Promise.resolve(null);
    this.clearTimer();
    let trustRejected = false;
    const generation = this.generation;
    const profile = this.profile;
    const wasWorking = this.snapshot.state === 'local' || this.snapshot.state === 'remote';
    if (!quiet) this.publish('reconnecting');
    const current = () => generation === this.generation && this.active;
    const probe = async (url: string) => {
      try { return await this.deps.probe(url); }
      catch (error) { if (current() && error instanceof PondTrustError) trustRejected = true; return false; }
    };
    const remote = profile.remoteAccess?.mode === 'embedded' && profile.remoteUrl ? profile.remoteUrl : null;
    // Probe only configured endpoints, without a bearer header. Every saved local address at
    // once; remote after the head start, or as soon as every local one has failed; discovery,
    // which can take seconds, alongside remote rather than ahead of it.
    const race = () => new Promise<Route | null>((resolve) => {
      const local = this.cellular ? [] : [...profile.localUrls];
      let pendingLocal = local.length;
      let remoteStarted = false;
      let remoteDone = remote === null;
      let discoveryDone = this.cellular;
      let settled = false;
      let headStart: ReturnType<typeof setTimeout> | null = null;
      const finish = (route: Route | null) => {
        if (settled) return;
        settled = true;
        if (headStart) clearTimeout(headStart);
        resolve(route);
      };
      const failIfExhausted = () => { if (pendingLocal === 0 && remoteDone && discoveryDone) finish(null); };
      const startRemote = () => {
        if (remoteStarted || remote === null) return;
        remoteStarted = true;
        void (async () => {
          const ready = this.deps.remoteReady ? await this.deps.remoteReady(() => settled || !current()) : true;
          const ok = ready && !settled && current() && await probe(remote);
          remoteDone = true;
          if (ok) finish({ state: 'remote', url: remote }); else failIfExhausted();
        })();
      };
      const startDiscovery = () => {
        if (discoveryDone) return;
        void (async () => {
          try {
            const found = await this.deps.discover(profile.host, profile.port);
            if (settled || !current() || !found || !isLocalPairingUrl(found)) return;
            const url = normalizeHttpsUrl(found);
            await this.deps.trust([...new Set([...profile.localUrls, url, ...(remote ? [remote] : [])])], this.pin);
            if (!settled && current() && await probe(url)) finish({ state: 'local', url, discovered: true });
          } catch {
            // A discovery failure only means this route is unavailable.
          } finally {
            discoveryDone = true;
            failIfExhausted();
          }
        })();
      };
      for (const url of local) {
        void probe(url).then((ok) => {
          pendingLocal--;
          if (ok) { finish({ state: 'local', url }); return; }
          if (pendingLocal === 0) { startRemote(); startDiscovery(); failIfExhausted(); }
        });
      }
      if (local.length === 0) { startRemote(); startDiscovery(); failIfExhausted(); }
      else if (remote !== null) headStart = setTimeout(() => { headStart = null; if (!settled && current()) startRemote(); }, LOCAL_HEAD_START_MS);
    });
    const work = async () => {
      // A route that was working gets a second pass, inside this same recovery, so the read that
      // asked for it is retried against the route it finds instead of failing.
      for (let pass = 0; pass < (wasWorking ? 2 : 1); pass++) {
        if (pass > 0) {
          await new Promise((resolve) => setTimeout(resolve, SECOND_CHANCE_MS));
          if (!current()) return null;
        }
        try {
          const route = await race();
          if (!current()) return null;
          if (route?.state === 'local') {
            if (route.discovered) this.profile = { ...profile, localUrls: [...new Set([route.url, ...profile.localUrls])].slice(0, 8) };
            this.clearTimer(); this.attempts = 0; this.localRechecks = 0; this.publish('local', route.url); return route.url;
          }
          if (route?.state === 'remote') {
            this.attempts = 0; this.publish('remote', route.url);
            // While on Wi-Fi, periodically reconsider LAN after a temporary local outage.
            // Stop after six unsuccessful passes; network/resume events reset this budget.
            if (!this.cellular && this.localRechecks++ < 6) {
              this.timer = setTimeout(() => { this.timer = null; if (current()) void this.recover(true); }, 30_000);
            }
            return route.url;
          }
        } catch {
          // Native TLS validation and discovery failures cannot change the saved pin.
        }
      }
      if (current()) {
        this.retryAfter = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5)) * (0.75 + Math.random() * 0.5);
        this.publish(trustRejected ? 'trust' : 'disconnected');
        if (this.attempts < 6) this.timer = setTimeout(() => { this.timer = null; if (current()) void this.recover(); }, Math.max(1, Math.ceil(this.retryAfter - Date.now())));
      }
      return null;
    };
    const flight = work().finally(() => { if (this.flight === flight) this.flight = null; });
    this.flight = flight;
    return flight;
  };
}
