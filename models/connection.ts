import { insecureDevMode } from '@/services/dev-mode';

/** Non-secret endpoint metadata. The public-key pin is held in SecureStore. */
export interface ConnectionProfile {
  version: 2;
  host: string;
  port: number;
  localUrls: string[];
  remoteUrl?: string;
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

/** Screens that are themselves the pairing the banner would send someone to. */
const PAIRING_SCREENS = ['pond-pairing', 'connect-desktop'];

/**
 * Whether the connection banner stays out of the way on the route `segments` name. First run and
 * pairing say where things stand in their own words, and the banner's title would sit stacked
 * above theirs, saying "pair with your Pond" on the very screen that is doing it.
 */
export function bannerHiddenOn(segments: readonly string[]): boolean {
  return segments[0] === '(onboarding)' || (segments[0] === '(stack)' && PAIRING_SCREENS.includes(segments[1] ?? ''));
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
    };
  } catch { return null; }
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
