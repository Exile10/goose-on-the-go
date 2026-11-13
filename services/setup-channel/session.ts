/**
 * One session on the setup channel: `hello`, the CPace exchange that claims or pairs, then sealed
 * `status`, `wifi_scan` and `wifi_join` (pond-setup-channel.md, "Messages"). The link under it is
 * any byte pipe that keeps order; on a phone it is a BLE connection (`services/ble.ts`).
 *
 * One request is in flight at a time. Anything the Pond should not have sent -- a frame that does
 * not parse, a sealed message that does not open, an answer to no question -- ends the session, as
 * it does on the Pond, because a counter out of step can never be put back.
 */

import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { APPROVAL_REQUIRED, readHeldPairing } from '@/models/pairing-lock';

import { ApiError, PondOutdatedError, type HandshakeResponse, type SpokenCode } from '../api-client';
import { confirmationMatches, NONCE_BYTES, respond, type CpaceResponse, type PakeCredential } from '../cpace';
import { PondTrustError } from '../pond-trust';
import { randomBytes } from '../secure-random';
import { chunk, encodeFrame, FrameReader } from './framing';
import { channelKeys, fromBase64, openMessage, SealedDirection, sealMessage, toBase64 } from './sealing';

/** The setup channel protocol this app speaks, as `hello` reports it. */
export const SETUP_CHANNEL_PROTOCOL = 1;
const PAKE_SUITE = 'CPACE-RISTR255-SHA512';
const PIN = /^sha256\/[A-Za-z0-9+/]{43}=$/;

/** An ordered byte pipe to one Pond. */
export interface SetupLink {
  /** The largest single write the link takes, `ATT_MTU - 3` over BLE. */
  readonly writeSize: number;
  write(bytes: Uint8Array): Promise<void>;
  /** Every notification, in order. Returns the unsubscribe. */
  onData(listener: (bytes: Uint8Array) => void): () => void;
  /** The link went away, from either end. */
  onClose(listener: (error?: Error) => void): () => void;
  close(): Promise<void>;
}

export type ChannelCapability = 'wifi_scan' | 'wifi_join' | 'spoken_code';

export interface ChannelHello {
  protocol: number;
  /** The card's four hex digits, which the advertised service UUID should already have said. */
  pondId: string | null;
  claimed: boolean;
  /** The Pond's public-key pin, which the exchange binds and HTTPS is later pinned to. */
  pin: string;
  capabilities: ChannelCapability[];
}

export type NetworkState = 'connected' | 'connecting' | 'disconnected';

export interface ChannelStatus {
  claimed: boolean;
  onboarded: boolean;
  network: { state: NetworkState; ssid: string | null; ipv4: string | null };
  httpsPort: number;
  hostname: string;
}

export type WifiSecurity = 'open' | 'wep' | 'wpa' | 'wpa2' | 'wpa3' | 'enterprise';

export interface WifiNetwork {
  ssid: string;
  security: WifiSecurity;
  /** 0 to 100. */
  signal: number;
  /** The Pond already holds this network's credentials. */
  known: boolean;
}

export interface WifiJoined {
  address: string;
  httpsPort: number;
  hostname: string;
}

/** The session is over: the link dropped, the Pond went quiet, or it sent something unreadable. */
export class SetupChannelClosed extends Error {
  constructor(reason: string) {
    super(`setup channel closed: ${reason}`);
    this.name = 'SetupChannelClosed';
  }
}

const TIMEOUT_MS = 15_000;
const SCAN_TIMEOUT_MS = 30_000;
// The Pond answers `timeout` itself when a join drags; this only covers a Pond that never answers.
const JOIN_TIMEOUT_MS = 90_000;

type Message = Record<string, unknown>;

interface Pending {
  id: number;
  type: string;
  resolve: (answer: Message) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** A refusal in the HTTPS API's own codes, as the pairing wizard already explains them. */
function refusal(type: string, answer: Message): ApiError {
  const code = typeof answer.error === 'string' && answer.error ? answer.error : 'refused';
  const wait = typeof answer.retry_after === 'number' && Number.isFinite(answer.retry_after) && answer.retry_after >= 0 ? answer.retry_after : null;
  // No HTTP here; a refusal that names a wait reads as the rate limit it is, any other as a refusal.
  return new ApiError(`${type} refused: ${code}`, wait !== null ? 429 : 400, wait, code, answer);
}

/** A refused verify, shaped as HTTPS answers it, so the wizard's sentences for each reason apply as they are. */
function refusedVerify(reason: string | null): HandshakeResponse {
  return {
    accepted: false,
    session_token: null,
    refresh_token: null,
    hostname: '',
    server_version: '',
    capabilities: [],
    rejection_reason: reason,
  };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseTag(hex: unknown): Uint8Array {
  try {
    return hexToBytes(str(hex));
  } catch {
    return new Uint8Array(0);
  }
}

export class SetupChannel {
  private readonly reader = new FrameReader();
  private readonly unsubscribe: (() => void)[];
  private nextId = 1;
  private pending: Pending | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private closed: SetupChannelClosed | null = null;
  private toPond: SealedDirection | null = null;
  private fromPond: SealedDirection | null = null;
  private greeting: ChannelHello | null = null;

  constructor(private readonly link: SetupLink, private readonly random: (count: number) => Uint8Array = randomBytes) {
    this.unsubscribe = [
      link.onData((bytes) => this.receive(bytes)),
      link.onClose((error) => this.fail(new SetupChannelClosed(error?.message ?? 'link closed'), false)),
    ];
  }

  /** Whether the exchange has run, so requests go sealed. */
  get sealed(): boolean {
    return this.toPond !== null;
  }

  get isClosed(): boolean {
    return this.closed !== null;
  }

  /** What the Pond said in `hello`, once it has. */
  get hello(): ChannelHello | null {
    return this.greeting;
  }

  async greet(): Promise<ChannelHello> {
    const answer = await this.request('hello', {});
    const pin = str(answer.pin);
    const protocol = typeof answer.protocol === 'number' ? answer.protocol : NaN;
    if (protocol !== SETUP_CHANNEL_PROTOCOL) throw new PondOutdatedError(answer.protocol);
    // A pin that is not one cannot be bound, and HTTPS could never be pinned to it.
    if (!PIN.test(pin)) {
      await this.close();
      throw new PondTrustError();
    }
    const known: ChannelCapability[] = ['wifi_scan', 'wifi_join', 'spoken_code'];
    const capabilities = Array.isArray(answer.capabilities)
      ? known.filter((c) => (answer.capabilities as unknown[]).includes(c))
      : [];
    const pondId = /^[0-9a-f]{4}$/.test(str(answer.pond_id)) ? str(answer.pond_id) : null;
    this.greeting = { protocol, pondId, claimed: answer.claimed === true, pin, capabilities };
    return this.greeting;
  }

  /** Have the Pond read a pairing code aloud. The answer never carries the code. */
  async spokenCode(): Promise<SpokenCode> {
    const answer = await this.request('spoken_code', {});
    if (answer.spoken !== true) throw new Error('Pond did not confirm that it said a code');
    return { spoken: true, expires_at: str(answer.expires_at) };
  }

  /**
   * Claim with a setup card's eleven digits, or pair with a six-digit code, exactly as
   * `PondApiClient.pair` does over HTTPS, under the pin `hello` gave. The tokens arrive sealed, and
   * are opened only after the Pond's confirmation verifies; from then on every request is sealed.
   */
  async exchange(input: { credential: PakeCredential; code: string; clientId: string; deviceName?: string }): Promise<HandshakeResponse> {
    const hello = this.greeting;
    if (!hello) throw new Error('hello first');
    if (this.sealed) throw new Error('the exchange has already run');
    const clientNonce = this.random(NONCE_BYTES);
    const init = await this.request('pake_init', {
      client_id: input.clientId,
      client_type: 'gotg',
      client_version: '1.0.0',
      channel_binding: hello.pin,
      client_nonce: toBase64(clientNonce),
      ...(input.credential !== 'pairing' ? { credential: input.credential } : {}),
    });
    let run: CpaceResponse;
    try {
      if (init.suite !== PAKE_SUITE) throw new Error(`unexpected suite ${String(init.suite)}`);
      run = respond({
        code: input.code,
        pin: hello.pin,
        clientId: input.clientId,
        credential: input.credential,
        challenge: fromBase64(str(init.challenge)),
        clientNonce,
        initiatorShare: fromBase64(str(init.share)),
        random: this.random,
        keepIsk: true,
      });
    } catch {
      await this.close();
      throw new PondTrustError();
    }
    const isk = run.isk as Uint8Array;
    try {
      let verify: Message;
      try {
        verify = await this.request('pake_verify', {
          challenge_id: str(init.challenge_id),
          device_name: input.deviceName?.trim() || null,
          share: toBase64(run.share),
          confirm: bytesToHex(run.confirm),
        });
      } catch (e) {
        // Every refusal is `ok: false`; a refused verify carries its reason as HTTPS's `rejection_reason`.
        const body = e instanceof ApiError ? (e.body as Message | null) : null;
        if (body?.accepted === false) return await this.refusedOrHeld(body, run);
        throw e;
      }
      if (verify.accepted === false) return await this.refusedOrHeld(verify, run);
      // Without the Pond's confirmation nothing in `sealed` can be trusted to be the Pond's.
      if (!confirmationMatches(parseTag(verify.server_proof), run.expectedServerConfirm)) {
        await this.close();
        throw new PondTrustError();
      }
      const keys = channelKeys(isk, run.sid);
      const fromPond = new SealedDirection(keys.pondToPhone);
      let tokens: Message;
      try {
        tokens = openMessage(fromPond, { sealed: verify.sealed });
      } catch (e) {
        fromPond.destroy();
        keys.phoneToPond.fill(0);
        await this.close();
        throw e;
      }
      this.fromPond = fromPond;
      this.toPond = new SealedDirection(keys.phoneToPond);
      const session = str(tokens.session_token);
      if (!session) {
        await this.close();
        throw new PondTrustError();
      }
      return {
        accepted: true,
        session_token: session,
        refresh_token: str(tokens.refresh_token) || null,
        expires_at: str(tokens.expires_at) || null,
        hostname: str(tokens.hostname),
        server_version: str(tokens.server_version),
        capabilities: Array.isArray(tokens.capabilities) ? tokens.capabilities.filter((c): c is string => typeof c === 'string') : [],
        rejection_reason: null,
        server_proof: str(verify.server_proof),
      };
    } finally {
      isk.fill(0);
    }
  }

  /**
   * A refused verify, as HTTPS answers it. One the pairing lock holds keeps its request, but only
   * once the Pond's confirmation verifies: the phone goes back to that Pond for its tokens.
   */
  private async refusedOrHeld(answer: Message, run: CpaceResponse): Promise<HandshakeResponse> {
    const reason = str(answer.rejection_reason) || str(answer.error) || null;
    const held = reason === APPROVAL_REQUIRED ? readHeldPairing(answer.pairing_request) : null;
    if (!held) return refusedVerify(reason);
    if (!confirmationMatches(parseTag(answer.server_proof), run.expectedServerConfirm)) {
      await this.close();
      throw new PondTrustError();
    }
    return { ...refusedVerify(reason), held };
  }

  async status(): Promise<ChannelStatus> {
    const answer = await this.sealedRequest('status', {});
    const network = (answer.network ?? {}) as Message;
    const state = network.state === 'connected' || network.state === 'connecting' ? network.state : 'disconnected';
    return {
      claimed: answer.claimed === true,
      onboarded: answer.onboarded === true,
      network: { state, ssid: str(network.ssid) || null, ipv4: str(network.ipv4) || null },
      httpsPort: typeof answer.https_port === 'number' ? answer.https_port : 0,
      hostname: str(answer.hostname),
    };
  }

  async wifiScan(): Promise<WifiNetwork[]> {
    const answer = await this.sealedRequest('wifi_scan', {}, SCAN_TIMEOUT_MS);
    const raw = Array.isArray(answer.networks) ? (answer.networks as Message[]) : [];
    const security: WifiSecurity[] = ['open', 'wep', 'wpa', 'wpa2', 'wpa3', 'enterprise'];
    return raw
      .filter((n) => typeof n?.ssid === 'string' && n.ssid.length > 0)
      .map((n) => ({
        ssid: n.ssid as string,
        security: security.includes(n.security as WifiSecurity) ? (n.security as WifiSecurity) : 'wpa2',
        signal: typeof n.signal === 'number' ? Math.max(0, Math.min(100, n.signal)) : 0,
        known: n.known === true,
      }));
  }

  /** The passphrase goes sealed and is never kept here; the caller holds it only while typing. */
  async wifiJoin(input: { ssid: string; passphrase?: string; hidden?: boolean }): Promise<WifiJoined> {
    const answer = await this.sealedRequest(
      'wifi_join',
      {
        ssid: input.ssid,
        ...(input.passphrase ? { passphrase: input.passphrase } : {}),
        ...(input.hidden ? { hidden: true } : {}),
      },
      JOIN_TIMEOUT_MS,
    );
    const address = str(answer.address);
    const httpsPort = typeof answer.https_port === 'number' ? answer.https_port : 0;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address) || httpsPort < 1 || httpsPort > 65535) {
      throw refusal('wifi_join', { error: 'no_address' });
    }
    return { address, httpsPort, hostname: str(answer.hostname) };
  }

  async close(): Promise<void> {
    this.fail(new SetupChannelClosed('closed'), true);
  }

  private sealedRequest(type: string, fields: Message, timeoutMs?: number): Promise<Message> {
    if (this.closed) return Promise.reject(this.closed);
    if (!this.sealed) return Promise.reject(new Error(`${type} needs the exchange first`));
    return this.request(type, fields, timeoutMs);
  }

  private request(type: string, fields: Message, timeoutMs = TIMEOUT_MS): Promise<Message> {
    const run = this.queue.then(() => this.send(type, fields, timeoutMs));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async send(type: string, fields: Message, timeoutMs: number): Promise<Message> {
    if (this.closed) throw this.closed;
    const id = this.nextId++;
    const message = { ...fields, id, type };
    const answered = new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new SetupChannelClosed(`${type} timed out`), true), timeoutMs);
      this.pending = { id, type, resolve, reject, timer };
    });
    try {
      const wire = encodeFrame(this.toPond ? sealMessage(this.toPond, message) : message);
      for (const part of chunk(wire, this.link.writeSize)) {
        if (this.closed) break;
        await this.link.write(part);
      }
    } catch (e) {
      this.fail(new SetupChannelClosed(e instanceof Error ? e.message : 'write failed'), true);
    }
    const answer = await answered;
    if (answer.ok !== true) throw refusal(type, answer);
    return answer;
  }

  private receive(bytes: Uint8Array): void {
    if (this.closed) return;
    try {
      for (const raw of this.reader.push(bytes)) {
        const answer = this.fromPond ? openMessage(this.fromPond, raw) : (raw as Message);
        const pending = this.pending;
        if (!pending || answer.id !== pending.id || answer.type !== pending.type) {
          throw new SetupChannelClosed('an answer to no question');
        }
        clearTimeout(pending.timer);
        this.pending = null;
        pending.resolve(answer);
      }
    } catch (e) {
      this.fail(e instanceof SetupChannelClosed ? e : new SetupChannelClosed(e instanceof Error ? e.message : 'unreadable'), true);
    }
  }

  private fail(reason: SetupChannelClosed, closeLink: boolean): void {
    if (this.closed) return;
    this.closed = reason;
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.toPond?.destroy();
    this.fromPond?.destroy();
    this.toPond = null;
    this.fromPond = null;
    this.unsubscribe.forEach((u) => u());
    if (closeLink) void this.link.close().catch(() => undefined);
  }
}
