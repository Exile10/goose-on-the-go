import { insecureDevMode } from '@/services/dev-mode';

/** Non-secret endpoint metadata. The public-key pin is held in SecureStore. */
export interface ConnectionProfile {
  version: 2;
  host: string;
  port: number;
  localUrls: string[];
  remoteUrl?: string;
  /**
   * The Pond's public tunnel (the household's own ngrok), learned from an authenticated
   * `/system/info` while home. Reached directly under the same pin; no embedded node.
   */
  tunnelUrl?: string;
  /** Missing on older profiles means local only until explicit activation. */
  remoteAccess?: { mode: 'local' } | { mode: 'embedded'; controlUrl: string };
}
/**
 * `revoked` is terminal and the others are not, which is the whole reason it
 * exists. Every other unhappy state describes a transport that might come back,
 * so the manager keeps probing; `revoked` says the Pond is reachable and has
 * stopped recognising this phone, which no amount of reconnecting can fix.
 * Without it a revoked pairing reads as a flapping network: the token-less
 * health probe keeps succeeding, every authenticated call keeps failing, and
 * the banner alternates between them forever.
 */
export type ConnectionState =
  | 'trust' | 'unpaired' | 'upgrade' | 'reconnecting'
  | 'local' | 'remote' | 'disconnected' | 'revoked';

/**
 * Whether the connection indicator has something to say in `state`. A working connection is not
 * one of them: the indicator appears when there is something to act on, and is the control that
 * acts on it.
 *
 * Screens read the same answer. While it is true the indicator owns the news that the Pond cannot
 * be used, so a screen whose content did not arrive says only that it will fill in, and never
 * repeats why (see `models/content-state.ts`).
 */
export function connectionNeedsAttention(state: ConnectionState): boolean {
  return state !== 'local' && state !== 'remote';
}

/**
 * Whether the indicator's action in `state` is pairing rather than another attempt to connect.
 *
 * `revoked` belongs here: the Pond is reachable and has stopped recognising this phone, so a retry
 * -- which probes endpoints without a token -- would report success and change nothing.
 */
export function connectionActionIsPairing(state: ConnectionState): boolean {
  return state === 'unpaired' || state === 'upgrade' || state === 'revoked';
}

/**
 * Why the latest check found no way to the Pond, from what the connection manager itself tried.
 * It knows which network the phone is on, whether outside access is set up and whether this
 * phone's own link for it came up. It does not know why an address did not answer, so no reason
 * claims to.
 */
export type UnreachableReason =
  /** On Wi-Fi with no outside access: the saved home addresses did not answer. */
  | 'local'
  /** On Wi-Fi: neither the home addresses nor outside access answered. */
  | 'local_and_remote'
  /** On mobile data: outside access is set up and the Pond did not answer through it. */
  | 'remote'
  /** On mobile data: this phone's own link for outside access did not come up. */
  | 'remote_link'
  /** On mobile data with no outside access set up: nothing reaches a home address from here. */
  | 'remote_off';

/** What the remote route came to on one check: not set up, this phone's link never came up, or no answer. */
export type RemoteOutcome = 'none' | 'node_not_ready' | 'no_answer';

export function unreachableReason(cellular: boolean, remote: RemoteOutcome): UnreachableReason {
  if (!cellular) return remote === 'none' ? 'local' : 'local_and_remote';
  if (remote === 'none') return 'remote_off';
  return remote === 'node_not_ready' ? 'remote_link' : 'remote';
}

/** What the connection manager knows about a connection that is not working. */
export interface ConnectionOutage {
  /** Checks in a row that found no route since the Pond last answered. */
  failures: number;
  /** Why the latest of them failed; null before one has. */
  reason: UnreachableReason | null;
  /** When the next automatic check runs, in epoch ms; null while one is running or none is planned. */
  nextCheckAt: number | null;
  /** When the Pond was last seen answering in this run of the app, in epoch ms, or null. */
  lastConnectedAt: number | null;
}

/**
 * How a connection that is not working is told:
 *
 * - `connecting`: nothing has answered yet in this run of the app, and nothing has failed;
 * - `reconnecting`: it was working and dropped, and the first few checks are still running;
 * - `unreachable`: those checks failed, or it never answered at all;
 * - `trust`: an address answered with a key that is not this Pond's;
 * - `pairing`: only pairing again can help (`connectionActionIsPairing`).
 */
export type ConnectionPhase = 'connected' | 'connecting' | 'reconnecting' | 'unreachable' | 'trust' | 'pairing';

/**
 * Failed checks in a row before a connection that dropped is called unreachable rather than
 * reconnecting. With the back-off at 1, 2 and 4 s and a check taking up to 3 s, that is about 7 to
 * 16 seconds: long enough for a network change to settle, short enough that someone waiting is told.
 */
export const UNREACHABLE_AFTER = 3;

export function connectionPhase(state: ConnectionState, outage: ConnectionOutage | null): ConnectionPhase {
  switch (state) {
    case 'local':
    case 'remote':
      return 'connected';
    case 'trust':
      return 'trust';
    case 'unpaired':
    case 'upgrade':
    case 'revoked':
      return 'pairing';
    case 'reconnecting':
    case 'disconnected':
      if (!outage) return state === 'reconnecting' ? 'connecting' : 'unreachable';
      if (outage.lastConnectedAt === null) return outage.failures === 0 ? 'connecting' : 'unreachable';
      return outage.failures < UNREACHABLE_AFTER ? 'reconnecting' : 'unreachable';
  }
}

/** What happens next: a check is running, one is due in `seconds`, or none is planned. */
export type NextCheck = { kind: 'checking' } | { kind: 'waiting'; seconds: number } | { kind: 'none' };

export function nextCheck(state: ConnectionState, outage: ConnectionOutage | null, now: number): NextCheck {
  if (state === 'reconnecting') return { kind: 'checking' };
  if (!outage || outage.nextCheckAt === null) return { kind: 'none' };
  const seconds = Math.ceil((outage.nextCheckAt - now) / 1000);
  // Past due: the timer has fired, and a check at the back-off's cap runs without announcing itself.
  return seconds > 0 ? { kind: 'waiting', seconds } : { kind: 'checking' };
}

/** Screens that are themselves the pairing the indicator would send someone to. */
const PAIRING_SCREENS = ['pond-pairing', 'connect-desktop'];

/**
 * Where the connection's state is told on the route `segments` name:
 *
 * - `banner`: the strip above the app, for the tabs and full-screen routes, which have no title
 *   bar for it to sit under;
 * - `inline`: under a stack screen's title bar, inside its content. Drawn above the app it stacked
 *   over the title bar, which kept its own status-bar inset beneath it, and the two read as two
 *   headers;
 * - `own`: the screen tells it itself. Home and Switch Pond carry a card for the Pond with the
 *   same state and actions; first run and pairing say where things stand in their own words.
 */
export type ConnectionSurface = 'banner' | 'inline' | 'own';

export function connectionSurface(segments: readonly string[]): ConnectionSurface {
  const [group, screen] = segments;
  if (group === '(onboarding)') return 'own';
  if (group === '(tabs)' && (screen === undefined || screen === 'index')) return 'own';
  if (group === '(stack)') return screen === 'switch-pond' || PAIRING_SCREENS.includes(screen ?? '') ? 'own' : 'inline';
  return 'banner';
}

/** `connectionSurface` for the stack screen named `screen`, as the stack's screen layout knows it. */
export function stackScreenSurface(screen: string): ConnectionSurface {
  return connectionSurface(['(stack)', screen]);
}

export function validPin(pin: string): boolean {
  return /^sha256\/[A-Za-z0-9+/]{43}=$/.test(pin);
}

/**
 * The start of a pin, grouped for reading aloud against the Pond's own screen.
 *
 * Twelve characters are 72 bits: nobody can generate a key whose pin shares them
 * with the real one, so matching these is as good as matching the whole pin.
 */
export function pinPreview(pin: string): string {
  const body = pin.replace(/^sha256\//, '').slice(0, 12);
  return `sha256/${body.match(/.{1,4}/g)?.join(' ') ?? ''}`;
}

const PIN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * The real preview of `pin` and two decoys, in random order, for a pin that came
 * off the network rather than from a QR or the user.
 *
 * A single "does this match?" can be tapped through without looking. Picking one
 * of three cannot: only the Pond's own screen says which. The decoys share the
 * real preview's first group, because a key whose pin starts with any chosen four
 * characters takes minutes to generate, so the user has to read all twelve.
 *
 * `randomBytes` must be a cryptographic source; it is a parameter so this stays pure.
 */
export function fingerprintChoices(
  pin: string,
  randomBytes: (count: number) => Uint8Array,
): string[] {
  const real = pinPreview(pin);
  const prefix = real.slice(0, 'sha256/AAAA'.length);
  const choices = [real];
  while (choices.length < 3) {
    // 256 is a multiple of 64, so every alphabet character is equally likely.
    const tail = Array.from(randomBytes(8), (byte) => PIN_ALPHABET[byte % 64]).join('');
    const decoy = `${prefix} ${tail.slice(0, 4)} ${tail.slice(4)}`;
    if (!choices.includes(decoy)) choices.push(decoy);
  }
  for (let i = choices.length - 1; i > 0; i--) {
    const j = uniformBelow(i + 1, randomBytes);
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices;
}

/** Whether the wizard's pin was checked (a QR, a typed fingerprint, a pick) or only advertised over mDNS. */
export type PinSource = 'checked' | 'advertised';

/**
 * Whether an advertised pin must be picked out against the Pond's screen before this exchange runs.
 * A setup code and a spoken code skip it: both run CPace with the pin in the channel identifier, so a
 * spoofed pin can only fail them, and a Pond that has no screen has nothing to pick against.
 */
export function pickBeforeExchange(exchange: {
  pin: PinSource;
  // A `device` run binds the pin as a setup run does, so only a six-digit pairing code needs the pick.
  credential: 'pairing' | 'setup' | 'device';
  codeSpoken: boolean;
}): boolean {
  return exchange.pin === 'advertised' && exchange.credential === 'pairing' && !exchange.codeSpoken;
}

/** A uniform integer in [0, bound), rejecting the bytes that would bias it. */
function uniformBelow(bound: number, randomBytes: (count: number) => Uint8Array): number {
  const limit = 256 - (256 % bound);
  for (;;) {
    const [byte] = randomBytes(1);
    if (byte < limit) return byte % bound;
  }
}

/** An origin with no credentials, path, query or fragment, under `protocol`. */
function bareOrigin(raw: string, protocol: 'https:' | 'http:'): URL | null {
  const url = new URL(raw);
  if (url.protocol !== protocol || !url.hostname || url.username || url.password ||
      (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return null;
  return url;
}

export function normalizeHttpsUrl(raw: string): string {
  const url = bareOrigin(raw, 'https:');
  if (!url) throw new Error('Invalid HTTPS Pond origin');
  return url.origin;
}

/**
 * A plaintext `http://` Pond origin on a LAN address, for insecure development mode.
 *
 * The same address rules as {@link isLocalPairingUrl}: loopback, `.local`, a bare
 * host name, or a private IPv4 address. It does not consult the flag itself; callers
 * reach it only through {@link normalizePondUrl} and {@link isInsecureDevOrigin}.
 */
function normalizeInsecureDevUrl(raw: string): string {
  const url = bareOrigin(raw, 'http:');
  if (!url || !isLanHost(url.hostname.toLowerCase())) throw new Error('Invalid plaintext development Pond origin');
  return url.origin;
}

/**
 * Normalise a Pond origin: HTTPS always, and also plaintext on a LAN address when
 * `insecureDevMode` is on. Outside that mode it is exactly {@link normalizeHttpsUrl}.
 */
export function normalizePondUrl(raw: string): string {
  if (insecureDevMode && new URL(raw).protocol === 'http:') return normalizeInsecureDevUrl(raw);
  return normalizeHttpsUrl(raw);
}

/** Whether `url` is a plaintext LAN origin this build may use: only in `insecureDevMode`. */
export function isInsecureDevOrigin(url: string): boolean {
  if (!insecureDevMode) return false;
  try { normalizeInsecureDevUrl(url); return true; } catch { return false; }
}

export function parseConnectionProfile(raw: unknown): ConnectionProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as ConnectionProfile;
  if (p.version !== 2 || typeof p.host !== 'string' || !p.host || !Number.isInteger(p.port) ||
      p.port < 1 || p.port > 65535 || !Array.isArray(p.localUrls) || !p.localUrls.length || p.localUrls.length > 8) return null;
  try {
    const remote = p.remoteAccess;
    if (remote && remote.mode !== 'local' && remote.mode !== 'embedded') return null;
    if (remote?.mode === 'embedded' && !p.remoteUrl) return null;
    return { version: 2, host: p.host, port: p.port,
      localUrls: [...new Set(p.localUrls.map(normalizePondUrl))],
      ...(remote ? { remoteAccess: remote.mode === 'embedded'
        ? { mode: 'embedded' as const, controlUrl: normalizeHttpsUrl(remote.controlUrl) }
        : { mode: 'local' as const } } : {}),
      ...(p.remoteUrl ? { remoteUrl: normalizeHttpsUrl(p.remoteUrl) } : {}),
      ...(p.tunnelUrl ? { tunnelUrl: tunnelOrigin(p.tunnelUrl) } : {}),
    };
  } catch { return null; }
}

/** Every saved way to reach the Pond from away: the tailnet address once enabled, and the tunnel. */
export function remoteRoutes(profile: ConnectionProfile): string[] {
  return [
    ...(profile.remoteAccess?.mode === 'embedded' && profile.remoteUrl ? [profile.remoteUrl] : []),
    ...(profile.tunnelUrl ? [profile.tunnelUrl] : []),
  ];
}

/**
 * The HTTPS origin of a Pond's public tunnel, from `host:port` or an origin. Refuses an address
 * literal and anything this phone would treat as its own network: a tunnel is never a LAN route.
 */
export function tunnelOrigin(raw: string): string {
  const origin = normalizeHttpsUrl(/^https:\/\//i.test(raw) ? raw : `https://${raw}`);
  const host = new URL(origin).hostname;
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[') || isLocalPairingUrl(origin)) {
    throw new Error('Invalid Pond tunnel origin');
  }
  return origin;
}

/**
 * What the saved tunnel becomes once the Pond, asked while home, reports `reported`: `null`
 * when nothing changes. A Pond too old to report the field (`undefined`) leaves it alone; one
 * reporting `null` has no tunnel running, so the saved one is dropped. An address this phone
 * cannot use is ignored rather than saved.
 */
export function tunnelChange(saved: string | undefined, reported: string | null | undefined): { tunnelUrl: string | undefined } | null {
  if (reported === undefined) return null;
  if (reported === null) return saved ? { tunnelUrl: undefined } : null;
  let next: string;
  try { next = tunnelOrigin(reported); } catch {
    console.warn('[connection] Pond reported an unusable tunnel address:', JSON.stringify(reported).slice(0, 120));
    return null;
  }
  return next === saved ? null : { tunnelUrl: next };
}

/** The phone rejects known remote addresses; the server checks the actual source subnet. */
export function isLocalPairingUrl(url: string): boolean {
  let host: string;
  try { host = new URL(normalizePondUrl(url)).hostname.toLowerCase(); }
  catch { return false; }
  return isLanHost(host);
}

/** Loopback, `.local`, a bare host name, or a private IPv4 address. */
function isLanHost(host: string): boolean {
  if (host === 'localhost' || host === '[::1]' || host.endsWith('.local')) return true;
  const parts = host.split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  }
  return !host.includes('.') && !host.includes(':') && /^[a-z0-9-]+$/.test(host);
}
