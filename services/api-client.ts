import { File } from 'expo-file-system';

import { assertPondTrust, PondTrustError, pondTrustFailed } from './pond-trust';
import { isInsecureDevOrigin, isLocalPairingUrl, normalizePondUrl } from '@/models/connection';
import { readWebSearch } from '@/models/web-search';
/**
 * PondApiClient — HTTP client for goose-in-a-pond.
 *
 * Implements the GIAP ↔ GOTG handshake protocol:
 *   1. handshakeInit    — POST /api/v1/handshake/pake/init   → challenge + the Pond's CPace share
 *   2. handshakeVerify  — POST /api/v1/handshake/pake/verify → tokens + the Pond's confirmation
 *   3. pair             — runs both with the six-digit code or a setup card's (see services/cpace.ts)
 *   4. handshakeRefresh                                      → fresh tokens
 *
 * The active session token is automatically attached to every request as
 * `Authorization: Bearer <token>`. On 401, the client tries one refresh
 * before bubbling the error up to the caller.
 */

import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { confirmationMatches, NONCE_BYTES, respond, type PakeCredential } from './cpace';
import { randomBytes } from './secure-random';
import { timeoutSignal } from './http';
import { readSse, type SseEvent } from './sse';
import type {
  ActivityPurge,
  RidePoint,
  RideQuote,
  ActivityResponse,
  ActivitySummary,
  ActivityWindow,
  CameraEvent,
  CommissionDeviceRequest,
  CommissionDeviceResponse,
  CreateDeviceRequest,
  Device,
  DeviceSelf,
  DeviceStatePatch,
  EventCategory,
  Extension,
  ExtensionSecretsResult,
  LogEntry,
  SecretSaveResult,
  TelemetrySummary,
  TurnMetrics,
  MarketplaceExtension,
  ChatFrame,
  ChatStreamRequest,
  ChatTurn,
  MatterStatus,
  ConsolidationEvent,
  MemoryFragment,
  Reminder,
  Proposal,
  ProposalDecision,
  ProposalDecisionResult,
  ProposalList,
  SaveMemoryRequest,
  UpdateMemoryRequest,
  PromptExtra,
  SavePromptExtraRequest,
  ModelActiveRoles,
  ModelCapabilities,
  ModelEntry,
  ModelListResponse,
  ModelMemoryStatus,
  NowPlayingResponse,
  OAuthProvider,
  Profile,
  CreateScheduleRequest,
  Rule,
  RuleRequest,
  Schedule,
  ScheduleResultEvent,
  ScheduleRun,
  UpdateScheduleRequest,
  SessionMessage,
  SessionSummary,
  SuggestionList,
  SystemInfo,
  ToolCallResult,
  TranscribeResponse,
  UpcomingSchedule,
  UpdateDeviceRequest,
  UsageSummary,
  WeatherResponse,
  WebSearchKeyResult,
  WebSearchState,
  DetectedPlace,
  PondSettings,
  RetitleResult,
  TtsApplyResult,
  ZoneChoice,
  DiskUsage,
  DownloadAction,
  DownloadEntry,
  HfModel,
  HfModelFile,
  ModelRole,
  CalibrationTake,
  OnboardCompletion,
  OnboardStatus,
  ProfilePrefs,
  WarmupStatus,
} from './types';
import { MODEL_CATEGORIES } from './types';

/**
 * A non-2xx response, carrying the pieces a caller needs to react properly —
 * chiefly the status and, on a 429, how long the server asked us to wait.
 * Without `retryAfterSecs` a caller can only guess, and guessing badly is how
 * a client ends up hammering an endpoint it has already been throttled on.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterSecs: number | null;
  /**
   * The Pond's own `{"error": "..."}` sentence, when it sent one. A 400 from
   * the scheduler says which field was wrong ("invalid cron expression", "a
   * rule needs at least one action"), which a form can show where a status
   * code could not. English, from the server: not for general display. Some
   * refusals carry a code here instead, such as enrollment's `stale_identity`,
   * which a caller matches rather than shows.
   */
  readonly detail: string | null;
  /** The refusal's parsed JSON, for a route whose answer is more than a sentence, such as `missing_fields`. */
  readonly body: unknown;

  constructor(message: string, status: number, retryAfterSecs: number | null, detail: string | null = null, body: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterSecs = retryAfterSecs;
    this.detail = detail;
    this.body = body;
  }

  /** True when retrying later could plausibly succeed. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** Parse a `Retry-After` header. Only the delta-seconds form is used here. */
function parseRetryAfter(res: Response): number | null {
  const raw = res.headers.get('Retry-After');
  if (!raw) return null;
  const secs = Number(raw.trim());
  return Number.isFinite(secs) && secs >= 0 ? secs : null;
}

export interface HandshakeResponse {
  accepted: boolean;
  session_token: string | null;
  refresh_token?: string | null;
  expires_at?: string | null;
  hostname: string;
  server_version: string;
  capabilities: string[];
  rejection_reason: string | null;
  /**
   * The Pond's CPace confirmation tag, T_server, as lowercase hex. Present on an
   * accepted pairing, and checked by {@link PondApiClient.pair} before any token
   * in this response is kept.
   */
  server_proof?: string | null;
}

/** The Pond's answer to `pake/init`: the challenge and its CPace share. */
export interface PakeChallenge {
  challenge_id: string;
  /** 32 bytes, standard base64: the Pond's half of sid. */
  challenge: string;
  expires_at: string;
  /** The only suite there is; anything else is refused. */
  suite: string;
  /** Ya, the Pond's 32-byte ristretto255 share, standard base64. */
  share: string;
}

/** The Pond's answer to `handshake/spoken-code`. It never carries the code, only that one was said. */
export interface SpokenCode {
  spoken: true;
  expires_at: string;
}

/** The suite `pake/init` must answer with. */
const PAKE_SUITE = 'CPACE-RISTR255-SHA512';

/**
 * The pairing protocol this app speaks, as `/system/info` reports it.
 *
 * There is exactly one: no fallback, and no negotiation. A Pond reporting
 * anything else is too old to pair with, and the user is told to update it.
 */
export const PAIRING_PROTOCOL = 3;

/** The Pond does not speak {@link PAIRING_PROTOCOL}. Shown as "update the Pond". */
export class PondOutdatedError extends Error {
  constructor(reported: unknown) {
    super(`Pond reports pairing protocol ${String(reported)}, this app needs ${PAIRING_PROTOCOL}`);
    this.name = 'PondOutdatedError';
  }
}

/** Standard base64 of `bytes`. */
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Bytes of standard base64 `b64`; throws on anything that is not. */
function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** The Pond's hex confirmation tag as bytes; anything that is not hex is an empty tag, which never matches. */
function parseTag(hex: string | null | undefined): Uint8Array {
  try { return hexToBytes(hex ?? ''); } catch { return new Uint8Array(0); }
}

/** How long to wait for /health before calling the Pond unreachable. */
const HEALTH_TIMEOUT_MS = 3_000;

/** Default ceiling for an ordinary request. A Pond on the LAN is close by. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Matter commissioning gets its own, far longer budget: the server allows itself
 * 180s for the radio work, so anything shorter here would abandon a commission
 * that was still going to succeed.
 */
const COMMISSION_TIMEOUT_MS = 190_000;

/**
 * Installing an extension, or restarting one with new credentials. The Pond
 * spawns it (`npx -y <package>`, which downloads the package the first time)
 * and answers only once it has started, which can take minutes. At the default
 * 15s the request was abandoned while the install was still going.
 */
const INSTALL_TIMEOUT_MS = 300_000;

/**
 * A chat turn, which is a language model generating on the Pond's own hardware.
 *
 * The default 15s is a LAN round trip, and this is not one: a 4B model on a
 * small box takes tens of seconds before the first token, and the route answers
 * whole rather than streaming, so nothing arrives until it is finished. At 15s
 * every answer was abandoned mid-generation and reported as a fetch error.
 */
const CHAT_TIMEOUT_MS = 180_000;

/**
 * How long a streaming turn may go silent before it is taken for dead.
 *
 * Not a budget for the turn: a turn can run for minutes. The Pond writes a
 * keep-alive comment after 15s without a frame, so a live stream is never quiet
 * for long, and a minute of nothing means the connection has gone.
 */
const STREAM_IDLE_MS = 60_000;

/** Transcription pads every clip to a 30s window, and the first speech call loads a model. */
const VOICE_TIMEOUT_MS = 45_000;

/**
 * Switching the speaking tier fetches its weights before the Pond answers, tens of megabytes. At the
 * default 15s a first switch on a fresh Pond was abandoned mid-download and reported as a failure.
 */
const TTS_APPLY_TIMEOUT_MS = 180_000;

/**
 * An event, as the frame it carries.
 *
 * `[DONE]` is an older end marker pond-desktop still honours; the Pond itself
 * ends with a `{done: true}` frame. A line that is not JSON is skipped — one
 * garbled frame should not end a turn that is otherwise arriving.
 */
function deliver(event: SseEvent, onFrame: (frame: ChatFrame) => void): void {
  if (event.data === '[DONE]') {
    onFrame({ done: true });
    return;
  }
  let frame: ChatFrame;
  try {
    frame = JSON.parse(event.data) as ChatFrame;
  } catch {
    return;
  }
  const seq = event.id === undefined ? NaN : Number(event.id);
  onFrame(Number.isFinite(seq) ? { ...frame, seq } : frame);
}

/**
 * Read a response body, tolerating the ones that have none.
 *
 * DELETE and the action routes answer 204, and `res.json()` throws on an empty
 * body — which would have turned every successful delete into an error the
 * caller had to special-case.
 */
async function parseBody<T>(res: Response): Promise<T | undefined> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (text.length === 0) return undefined;
  return JSON.parse(text) as T;
}

/** A handshake refusal, read from one body: the Pond names a wait in `retry_after` as well as in Retry-After. */
async function handshakeRefusal(message: string, res: Response): Promise<ApiError> {
  const body = (await parseBody<{ error?: unknown; retry_after?: unknown }>(res).catch(() => undefined)) ?? {};
  const detail = typeof body.error === 'string' && body.error.trim() ? body.error : null;
  const wait = body.retry_after;
  const bodyWait = typeof wait === 'number' && Number.isFinite(wait) && wait >= 0 ? wait : null;
  return new ApiError(message, res.status, parseRetryAfter(res) ?? bodyWait, detail);
}

/** A refusal's JSON body, or null for any other body. */
async function errorBody(res: Response): Promise<unknown> {
  try {
    return (await parseBody<unknown>(res)) ?? null;
  } catch {
    return null;
  }
}

/** The `error` string of a refusal's body, or null. */
function detailOf(body: unknown): string | null {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' && error.trim() ? error : null;
}

async function errorDetail(res: Response): Promise<string | null> {
  return detailOf(await errorBody(res));
}

/** The guard's refusal of every protected route until the Pond's owner has finished setting it up. */
export const ONBOARDING_REQUIRED = 'onboarding_required';

/**
 * The Pond's 501 for consolidation when its build has no runner, as opposed to the setting being
 * off (`start_consolidation` in `pond-api/src/routes.rs`). The two want different fixes.
 */
export const CONSOLIDATION_NOT_BUILT = 'Memory consolidation is not available in this build';


/**
 * Unwrap a collection that may arrive bare or inside an envelope.
 *
 * The envelope is input, not a guarantee. Nine wrappers declared the body as
 * `{ key: T[] } | T[]` and returned `res.key` for the object case, which types as
 * `T[]` whatever the server actually sent -- so a Pond answering `{}`, or an
 * envelope carrying a null list, produced `undefined`. That reached a screen as
 * state and threw on the first `.find` or `.map`, which is how opening AI Models
 * killed the app rather than showing the empty state it already has.
 *
 * A shape the client did not expect is an empty collection, and every one of
 * these screens has something to say about an empty collection.
 */
function collection<T>(res: unknown, key: string): T[] {
  if (Array.isArray(res)) return res as T[];
  const value = (res as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Refresh responses that mean the Pond will not accept this refresh token. */
const REFRESH_REFUSED = [400, 401, 403, 404, 410];

export class PondApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private refreshToken: string | null = null;
  /** Called after a refresh succeeds so the caller can re-persist the pair. */
  private onTokensRotated: ((session: string, refresh: string) => void) | null = null;
  /** The refresh every concurrent 401 waits on, rather than each starting its own. */
  private refreshInFlight: Promise<HandshakeResponse | null> | null = null;

  private recovery: (() => Promise<string | null>) | null = null;
  private authRevoked: (() => void) | null = null;
  private onboardingRequired: (() => void) | null = null;
  private identityEpoch = 0;
  setRecovery(recover: (() => Promise<string | null>) | null) { this.recovery = recover; }

  /**
   * Called when the Pond refuses this phone's credentials and a refresh cannot
   * replace them -- the device was unregistered, or its session was revoked.
   *
   * Distinct from `setRecovery`, which exists for a transport that might come
   * back. This one cannot be recovered from by trying again, and saying so is
   * what stops the connection banner alternating between "connected" (the
   * token-less health probe still succeeds) and "reconnecting" (every real
   * request still fails).
   */
  setAuthRevoked(onRevoked: (() => void) | null) { this.authRevoked = onRevoked; }
  /** Called when the Pond refuses a request because its owner has not finished setting it up. */
  setOnboardingRequired(onRequired: (() => void) | null) { this.onboardingRequired = onRequired; }
  invalidateIdentity() { this.identityEpoch++; this.token = null; this.refreshToken = null; }

  constructor(baseUrl = 'https://127.0.0.1:4443') {
    this.baseUrl = normalizePondUrl(baseUrl);
  }

  setBaseUrl(url: string) {
    this.baseUrl = normalizePondUrl(url);
  }

  setToken(token: string | null) {
    this.token = token;
  }

  setRefreshToken(token: string | null) {
    this.refreshToken = token;
  }

  setOnTokensRotated(cb: ((session: string, refresh: string) => void) | null) {
    this.onTokensRotated = cb;
  }

  /**
   * Every request to the Pond goes through here: the pin is checked, redirects
   * are refused, and a request is cut off at `timeoutMs` unless the caller
   * passes its own `signal`. A stream passes `null`, since silence there is
   * the stream's to judge.
   */
  private async send(url: string, init: RequestInit, timeoutMs: number | null = REQUEST_TIMEOUT_MS): Promise<Response> {
    const epoch = this.identityEpoch;
    const origin = new URL(url).origin;
    await assertPondTrust(origin);
    if (epoch !== this.identityEpoch) throw new Error('Pond profile changed');
    const headers = new Headers(init.headers);
    // The marker asks PondTls to pin this request, and PondTls refuses it over plain HTTP.
    // A plaintext development origin has no pin, so it goes out as an ordinary fetch.
    if (!isInsecureDevOrigin(origin)) headers.set('X-Pond-Transport', '1');
    const response = await fetch(url, { ...init, headers, redirect: 'error',
      signal: init.signal ?? (timeoutMs === null ? undefined : timeoutSignal(timeoutMs)) });
    if (epoch !== this.identityEpoch) throw new Error('Pond profile changed');
    if (response.status >= 300 && response.status < 400) throw new Error('Pond redirect rejected');
    return response;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  /**
   * Probe the server's unauthenticated /health route.
   *
   * Never throws: an unreachable Pond is an expected state here, not an error,
   * so callers get `ok: false` rather than a rejection to handle.
   */
  async health(): Promise<{ ok: boolean; latencyMs: number; trustFailure?: boolean }> {
    const start = Date.now();
    try {
      const res = await this.send(`${this.baseUrl}/api/v1/health`, {
        headers: {},
        signal: timeoutSignal(HEALTH_TIMEOUT_MS),
      });
      return { ok: res.ok, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start, trustFailure: await pondTrustFailed(this.baseUrl).catch(() => true) };
    }
  }

  /**
   * Phase 1: open a CPace run. The Pond commits to its newest pairing code,
   * answers with its share, and holds its secret scalar for 60 seconds.
   *
   * The Pond compares `channelBinding` with its own pin only as an early,
   * readable refusal (`channel_binding_mismatch`). The binding that protects
   * anything is the pin inside the CPace generator; see services/cpace.ts.
   */
  async handshakeInit(input: {
    clientId: string;
    channelBinding: string;
    /** This phone's half of sid, {@link NONCE_BYTES} from the platform CSPRNG. */
    clientNonce: Uint8Array;
    credential?: PakeCredential;
    clientType?: string;
    clientVersion?: string;
  }): Promise<PakeChallenge> {
    const res = await this.send(`${this.baseUrl}/api/v1/handshake/pake/init`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        client_id: input.clientId,
        client_type: input.clientType ?? 'gotg',
        client_version: input.clientVersion ?? '1.0.0',
        channel_binding: input.channelBinding,
        client_nonce: toBase64(input.clientNonce),
        // Absent means pairing, so a pairing init is still the request the Pond's vectors pin.
        ...(input.credential && input.credential !== 'pairing' ? { credential: input.credential } : {}),
      }),
    });
    if (!res.ok) throw await handshakeRefusal(`handshake/pake/init failed: ${res.status}`, res);
    return (await res.json()) as PakeChallenge;
  }

  /** Phase 2: send this phone's CPace share and its confirmation tag. */
  async handshakeVerify(input: {
    challengeId: string;
    /** Yb, sent as standard base64. */
    share: Uint8Array;
    /** T_client, sent as lowercase hex. */
    confirm: Uint8Array;
    deviceName?: string;
  }): Promise<HandshakeResponse> {
    const res = await this.send(`${this.baseUrl}/api/v1/handshake/pake/verify`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        challenge_id: input.challengeId,
        device_name: input.deviceName ?? null,
        share: toBase64(input.share),
        confirm: bytesToHex(input.confirm),
      }),
    });
    if (!res.ok) throw await handshakeRefusal(`handshake/pake/verify failed: ${res.status}`, res);
    return (await res.json()) as HandshakeResponse;
  }

  /**
   * Pair with the six-digit code, or claim with a setup card's, over CPace. On
   * success the session+refresh tokens are stored on this client (use
   * {@link setOnTokensRotated} to persist).
   *
   * Throws {@link PondOutdatedError} before sending anything when the Pond does
   * not report {@link PAIRING_PROTOCOL}, and {@link PondTrustError} when the
   * Pond's answers do not check out: a malformed or invalid share, or an
   * acceptance without the confirmation tag only the code's holder can make.
   */
  async pair(input: {
    clientId: string;
    /** The six pairing digits, or the eleven setup digits without dashes when `credential` is setup. */
    pairingCode: string;
    credential?: PakeCredential;
    deviceName?: string;
    /**
     * The Pond public-key pin this connection is pinned to. It goes into the
     * CPace channel identifier, so a phone pinned to any key but the Pond's runs
     * a different generator and the exchange fails. On a plaintext development
     * origin it is the pin the Pond reported for itself, which binds nothing.
     */
    channelBinding: string;
  }): Promise<HandshakeResponse> {
    const epoch = this.identityEpoch;
    const info = await this.systemInfo();
    if (info.protocol !== PAIRING_PROTOCOL) {
      console.warn('[pairing] Pond reports pairing protocol', info.protocol ?? 'none', 'and needs an update');
      throw new PondOutdatedError(info.protocol);
    }
    if (isInsecureDevOrigin(this.baseUrl)) {
      console.warn('[pairing] over a plaintext development connection: the pin binds nothing');
    }
    const clientNonce = randomBytes(NONCE_BYTES);
    const init = await this.handshakeInit({
      clientId: input.clientId,
      channelBinding: input.channelBinding,
      clientNonce,
      credential: input.credential,
    });
    if (epoch !== this.identityEpoch) throw new Error('Pond profile changed');
    let exchange: ReturnType<typeof respond>;
    try {
      if (init.suite !== PAKE_SUITE) throw new Error(`unexpected suite ${String(init.suite)}`);
      exchange = respond({
        code: input.pairingCode,
        pin: input.channelBinding,
        clientId: input.clientId,
        credential: input.credential,
        challenge: fromBase64(init.challenge),
        clientNonce,
        initiatorShare: fromBase64(init.share),
        random: randomBytes,
      });
    } catch (error) {
      // A Pond that speaks protocol 3 does not send these. Whatever did is not
      // to be answered with a share derived from the code.
      console.warn('[pairing] refused the Pond\'s CPace answer:', error instanceof Error ? error.message : error);
      throw new PondTrustError();
    }
    const resp = await this.handshakeVerify({
      challengeId: init.challenge_id,
      share: exchange.share,
      confirm: exchange.confirm,
      deviceName: input.deviceName,
    });
    if (epoch !== this.identityEpoch) throw new Error('Pond profile changed');
    // The Pond's confirmation. Without it, something that terminated this
    // connection with its own certificate could invent an acceptance and a token
    // of its own, and this phone would be paired with the interceptor. Only the
    // party that ran CPace with the right code and the same pin can produce it.
    if (resp.accepted && !confirmationMatches(parseTag(resp.server_proof), exchange.expectedServerConfirm)) {
      console.warn('[pairing] the Pond\'s confirmation did not verify; no token kept');
      this.token = null;
      this.refreshToken = null;
      throw new PondTrustError();
    }
    if (resp.accepted && resp.session_token) {
      this.token = resp.session_token;
      this.refreshToken = resp.refresh_token ?? null;
      if (resp.refresh_token && this.onTokensRotated) {
        this.onTokensRotated(resp.session_token, resp.refresh_token);
      }
    }
    return resp;
  }

  /**
   * Ask the Pond to read a pairing code aloud, for a phone with no card and no screen to read one from.
   * No token and no body: the Pond answers only LAN peers, and only someone in earshot learns the code.
   */
  async requestSpokenCode(): Promise<SpokenCode> {
    const res = await this.send(`${this.baseUrl}/api/v1/handshake/spoken-code`, { method: 'POST', headers: {} });
    if (!res.ok) throw await handshakeRefusal(`handshake/spoken-code failed: ${res.status}`, res);
    const body = await parseBody<{ spoken?: unknown; expires_at?: unknown }>(res);
    if (body?.spoken !== true) throw new Error('Pond did not confirm that it said a code');
    return { spoken: true, expires_at: typeof body.expires_at === 'string' ? body.expires_at : '' };
  }

  /** Exchange the stored refresh token for a fresh pair. */
  async handshakeRefresh(): Promise<HandshakeResponse | null> {
    if (!this.refreshToken) return null;
    const epoch = this.identityEpoch;
    const res = await this.send(`${this.baseUrl}/api/v1/handshake/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.refreshToken }),
    });
    if (!res.ok) {
      // Only the Pond refusing the refresh token says these credentials are dead.
      // A rate limit, a restart or a gateway error says nothing about them, and
      // treating it as a refusal revoked -- and since #59, wiped -- a pairing
      // whose refresh token was still good.
      if (REFRESH_REFUSED.includes(res.status)) return null;
      throw new ApiError(`handshake/refresh → ${res.status}`, res.status, parseRetryAfter(res));
    }
    const body = (await res.json()) as HandshakeResponse;
    if (epoch !== this.identityEpoch) throw new Error('Pond profile changed');
    if (body.accepted && body.session_token) {
      this.token = body.session_token;
      this.refreshToken = body.refresh_token ?? null;
      if (body.refresh_token && this.onTokensRotated) {
        this.onTokensRotated(body.session_token, body.refresh_token);
      }
    }
    return body;
  }

  /** Revoke the current session token on the server. */
  async handshakeRevoke(): Promise<void> {
    if (!this.token) return;
    const response = await this.send(`${this.baseUrl}/api/v1/handshake/revoke`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ token: this.token }),
    });
    if (!response.ok) throw new ApiError('Pond revocation failed', response.status, parseRetryAfter(response));
    const result = await response.json();
    if (result?.revoked !== true) throw new Error('Pond revocation was not acknowledged');
    this.token = null;
    this.refreshToken = null;
  }

  /**
   * Wrapper around `fetch` that attaches the bearer token and transparently
   * refreshes once on 401. Returns the parsed JSON body.
   *
   * Concurrent 401s share one refresh. Without that, a screen firing several
   * requests at once on a stale token would send a refresh per request, and
   * every one but the first would present an already-rotated refresh token —
   * turning one recoverable expiry into a forced re-pair.
   */
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!path.startsWith('/api/') || path.startsWith('//')) throw new Error('Invalid Pond API path');
    const epoch = this.identityEpoch;
    const doFetch = () =>
      this.send(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.headers(), ...(init.headers ?? {}) },
        signal: init.signal ?? timeoutSignal(REQUEST_TIMEOUT_MS),
      });

    let res: Response;
    try { res = await doFetch(); }
    catch (error) {
      if (init.signal?.aborted || epoch !== this.identityEpoch || !this.recovery) throw error;
      const recovered = await this.recovery();
      if (!recovered || epoch !== this.identityEpoch || !['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase())) throw error;
      this.setBaseUrl(recovered);
      res = await doFetch();
    }
    if (res.status === 401 && this.refreshToken) {
      const refreshed = await this.refreshOnce();
      if (refreshed?.accepted) res = await doFetch();
    }
    // Still refused after the one refresh this client allows itself: the
    // credentials are dead rather than stale, and no retry will revive them.
    // Reported once here so the whole app can settle, instead of each screen
    // discovering it separately and asking the transport to reconnect.
    if (res.status === 401 && epoch === this.identityEpoch) this.authRevoked?.();
    if (!res.ok) {
      const body = await errorBody(res);
      const detail = detailOf(body);
      if (res.status === 403 && detail === ONBOARDING_REQUIRED && epoch === this.identityEpoch) this.onboardingRequired?.();
      // Message format unchanged — existing logs stay readable.
      throw new ApiError(
        `${init.method ?? 'GET'} ${path} → ${res.status}`,
        res.status,
        parseRetryAfter(res),
        detail,
        body,
      );
    }
    return (await parseBody<T>(res)) as T;
  }

  /**
   * `request` without the JSON: the authenticated `Response` itself, for a body
   * that is a stream of events or a run of audio bytes rather than a document.
   *
   * Same bearer, same single refresh on 401, same `ApiError` on refusal. No
   * default timeout: a stream decides for itself when silence means dead, and
   * a caller that wants a ceiling passes its own `signal`.
   */
  async open(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const doFetch = () =>
      this.send(url, { ...init, headers: { ...this.headers(), ...(init.headers ?? {}) } }, null);

    let res = await doFetch();
    if (res.status === 401 && this.refreshToken) {
      const refreshed = await this.refreshOnce();
      if (refreshed?.accepted) res = await doFetch();
    }
    if (!res.ok) {
      const detail = await errorDetail(res);
      if (res.status === 403 && detail === ONBOARDING_REQUIRED) this.onboardingRequired?.();
      throw new ApiError(
        `${init.method ?? 'GET'} ${path} → ${res.status}`,
        res.status,
        parseRetryAfter(res),
        detail,
      );
    }
    return res;
  }

  /**
   * A picture the Pond holds, in the shape `expo-image` loads.
   *
   * Attachment routes take the bearer header and nothing else — no cookie, no
   * token in the query — so a bare URI draws a broken image. The path is the
   * relative `url` the messages route returns.
   */
  imageSource(path: string): { uri: string; headers?: Record<string, string> } {
    const uri = /^https?:/i.test(path) ? path : `${this.baseUrl}${path}`;
    return this.token ? { uri, headers: { Authorization: `Bearer ${this.token}` } } : { uri };
  }

  /** Local enrollment stays on the selected LAN endpoint even if normal traffic roams.
   * No recovery or token rotation is attempted: the caller must restart explicitly
   * after an expired session or ambiguous failure. Server peer checks remain authoritative.
   */
  async requestLocal<T>(endpoint: string, path: string, init: RequestInit = {}): Promise<T> {
    if (!isLocalPairingUrl(endpoint)) throw new Error('Local Pond endpoint required');
    if (!path.startsWith('/api/') || path.startsWith('//')) throw new Error('Invalid Pond API path');
    const response = await this.send(`${normalizePondUrl(endpoint)}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers ?? {}) },
      signal: init.signal ?? timeoutSignal(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ApiError(`${init.method ?? 'GET'} ${path} → ${response.status}`, response.status, parseRetryAfter(response),
        await errorDetail(response));
    }
    return (await parseBody<T>(response)) as T;
  }

  /** Used by SSE without starting a competing token rotation. */
  async refreshAuthentication(): Promise<boolean> { return !!(await this.refreshOnce())?.accepted; }

  /** Coalesce concurrent refreshes into the single in-flight attempt. */
  private refreshOnce(): Promise<HandshakeResponse | null> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.handshakeRefresh().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  // ── Devices and Matter ──────────────────────────────────────

  /** `GET /devices`. The server wraps the list in an envelope; callers get the list. */
  async listDevices(): Promise<Device[]> {
    const res = await this.request<{ devices?: Device[] } | Device[]>('/api/v1/devices');
    return collection<Device>(res, 'devices');
  }

  registerDevice(req: CreateDeviceRequest): Promise<Device> {
    return this.post<Device>('/api/v1/devices', req);
  }

  updateDevice(id: string, req: UpdateDeviceRequest): Promise<Device> {
    return this.put<Device>(`/api/v1/devices/${encodeURIComponent(id)}`, req);
  }

  /**
   * `DELETE /devices/{id}`. The server refuses bridged Matter endpoints — ids
   * shaped `matter-<node>-<endpoint>` — because one node is not one device.
   */
  deleteDevice(id: string): Promise<void> {
    return this.del<void>(`/api/v1/devices/${encodeURIComponent(id)}`);
  }

  /**
   * `POST /devices/commission`. Accepts a QR payload (`MT:…`), an 11/21-digit
   * manual code, or a bare 8-digit passcode.
   *
   * The setup code is a credential — never log the request. The server budgets
   * 180s for this, so it gets its own longer timeout rather than the default.
   */
  commissionDevice(req: CommissionDeviceRequest): Promise<CommissionDeviceResponse> {
    return this.request<CommissionDeviceResponse>('/api/v1/devices/commission', {
      method: 'POST',
      body: JSON.stringify(req),
      signal: timeoutSignal(COMMISSION_TIMEOUT_MS),
    });
  }

  matterStatus(): Promise<MatterStatus> {
    return this.get<MatterStatus>('/api/v1/matter/status');
  }

  /**
   * Actuate a device.
   *
   * There is no REST control route. Actuation goes through the LLM-free MCP
   * dispatch path, which is deny-by-default: `DIRECT_DISPATCH_ALLOWLIST` on the
   * server permits `set_device_state` and `get_device_state` and little else, so
   * this is the only shape that works.
   */
  setDeviceState(deviceId: string, patch: DeviceStatePatch): Promise<ToolCallResult> {
    return this.post<ToolCallResult>('/api/v1/tools/invoke', {
      server: 'giap-device-control',
      tool: 'set_device_state',
      args: { device_id: deviceId, ...patch },
    });
  }

  /**
   * Read a device's current state.
   *
   * The counterpart to the above, and the reason it exists: `is_online` is
   * reachability, not power. Labelling a button from it is what once offered
   * "Turn on" to a contact sensor.
   */
  getDeviceState(deviceId: string): Promise<ToolCallResult> {
    return this.post<ToolCallResult>('/api/v1/tools/invoke', {
      server: 'giap-device-control',
      tool: 'get_device_state',
      args: { device_id: deviceId },
    });
  }

  // ── Chat ────────────────────────────────────────────────────

  /**
   * One turn of conversation.
   *
   * The Pond answers whole rather than in pieces on this route, and it creates
   * the session when `sessionId` is absent — which is why the reply carries the
   * id back: a first message is also how a conversation begins.
   *
   * `voiceMode` is sent but has no effect here: the handler calls `chat_once`,
   * which hardcodes it off, and drops images the same way. Turns that need
   * either go through `streamChat`.
   */
  sendChat(
    message: string,
    sessionId?: string | null,
    voiceMode = false,
  ): Promise<ChatTurn> {
    return this.request<ChatTurn>('/api/v1/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        ...(sessionId ? { session_id: sessionId } : {}),
        voice_mode: voiceMode,
      }),
      signal: timeoutSignal(CHAT_TIMEOUT_MS),
    });
  }

  /**
   * One turn, read as the Pond produces it: text as it is written, each tool as
   * it is called and as it answers.
   *
   * Resolves when the stream ends, whichever way. Whether it ended well is in
   * the frames — a `done`, or an `{error}` with nothing after it — so a caller
   * decides from what it saw, not from this promise.
   *
   * The Pond holds four streams open at most and refuses a fifth with 503, so a
   * stream that is given up on must be cancelled rather than abandoned: pass a
   * `signal` and abort it.
   */
  async streamChat(
    body: ChatStreamRequest,
    onFrame: (frame: ChatFrame) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await this.open('/api/v1/chat/stream', {
      method: 'POST',
      headers: { Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
    await readSse(res, (event) => deliver(event, onFrame), { idleMs: STREAM_IDLE_MS });
  }

  /**
   * Pick a resumable turn back up after the connection dropped.
   *
   * `afterSeq` is exclusive. A 410 means the Pond restarted and the run is gone,
   * a 404 that it finished long enough ago to be forgotten; either way the
   * answer, if there is one, is in the session's saved messages.
   */
  async reattachRun(
    runId: string,
    afterSeq: number,
    epoch: number | string | undefined,
    onFrame: (frame: ChatFrame) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const q = new URLSearchParams({ after_seq: String(afterSeq) });
    if (epoch !== undefined) q.set('epoch', String(epoch));
    const res = await this.open(
      `/api/v1/chat/runs/${encodeURIComponent(runId)}/events?${q.toString()}`,
      { headers: { Accept: 'text/event-stream' }, signal },
    );
    await readSse(res, (event) => deliver(event, onFrame), { idleMs: STREAM_IDLE_MS });
  }

  /**
   * Stop a turn the Pond is still running. Cooperative: it may say one more
   * thing. A 404 means the run already ended on its own, which is not a
   * failure from the caller's side.
   */
  async cancelRun(runId: string): Promise<void> {
    try {
      await this.post(`/api/v1/chat/runs/${encodeURIComponent(runId)}/cancel`, {});
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    }
  }

  /** What the Pond would offer to answer next. `sessionId` decides whose data it can read. */
  listSuggestions(sessionId?: string | null): Promise<SuggestionList> {
    const q = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
    return this.get<SuggestionList>(`/api/v1/suggestions${q}`);
  }

  /** Tell the Pond a composed suggestion was used, so it stops offering it. */
  takeSuggestion(id: string): Promise<unknown> {
    return this.post(`/api/v1/suggestions/${encodeURIComponent(id)}/taken`, {});
  }

  /**
   * The name the household gave the Pond for its owner, for a greeting.
   *
   * `GET /settings` is where pond-desktop reads it, not the profiles list. Null
   * when unset; a greeting then leaves the name out rather than inventing one.
   */
  async userName(): Promise<string | null> {
    const settings = await this.get<{ user_name?: string | null }>('/api/v1/settings');
    return settings.user_name?.trim() || null;
  }

  // ── Voice ───────────────────────────────────────────────────

  /**
   * Speech to text. WAV only — the Pond sniffs the RIFF header and rejects
   * anything else — sent as the multipart field `audio`. Under 2 MiB, which is
   * about a minute at 16 kHz mono.
   */
  async transcribe(fileUri: string): Promise<string> {
    const form = new FormData();
    // A real `File` — it implements `Blob` — not the `{uri,name,type}` shape older RN
    // FormData once special-cased; this RN's FormData rejects anything that isn't one.
    form.append('audio', new File(fileUri), 'speech.wav');
    const res = await this.send(`${this.baseUrl}/api/v1/transcribe`, {
      method: 'POST',
      // No Content-Type: the runtime writes the multipart boundary itself.
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      body: form,
      signal: timeoutSignal(VOICE_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new ApiError(`POST /api/v1/transcribe → ${res.status}`, res.status, parseRetryAfter(res));
    }
    const body = (await res.json()) as TranscribeResponse;
    return body.text?.trim() ?? '';
  }

  /**
   * Text to speech: the whole sentence as a 24 kHz mono WAV. Synthesis finishes
   * before the first byte, so speak a reply a sentence at a time. The first
   * call after the Pond starts loads its voice model, which can take seconds.
   */
  async speak(text: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const res = await this.send(`${this.baseUrl}/api/v1/tts`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ text }),
      signal: signal ?? timeoutSignal(VOICE_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new ApiError(`POST /api/v1/tts → ${res.status}`, res.status, parseRetryAfter(res));
    }
    return res.arrayBuffer();
  }

  // ── Sessions ────────────────────────────────────────────────

  async listSessions(): Promise<SessionSummary[]> {
    const res = await this.request<{ sessions?: SessionSummary[] } | SessionSummary[]>(
      '/api/v1/sessions',
    );
    return collection<SessionSummary>(res, 'sessions');
  }

  getSession(id: string): Promise<SessionSummary> {
    return this.get<SessionSummary>(`/api/v1/sessions/${encodeURIComponent(id)}`);
  }

  async listSessionMessages(id: string, limit?: number): Promise<SessionMessage[]> {
    const q = limit ? `?limit=${limit}` : '';
    const res = await this.request<{ messages?: SessionMessage[] } | SessionMessage[]>(
      `/api/v1/sessions/${encodeURIComponent(id)}/messages${q}`,
    );
    return collection<SessionMessage>(res, 'messages');
  }

  deleteSession(id: string): Promise<void> {
    return this.del<void>(`/api/v1/sessions/${encodeURIComponent(id)}`);
  }

  renameSession(id: string, title: string): Promise<void> {
    return this.request<void>(`/api/v1/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  }

  usageSummary(): Promise<UsageSummary> {
    return this.get<UsageSummary>('/api/v1/usage/summary');
  }

  // ── Reminders ───────────────────────────────────────────────

  /**
   * Pending reminders, most recently said first, narrowed by the Pond to the
   * household member this phone is paired as. The Pond pages at 100 by default.
   */
  async listReminders(): Promise<Reminder[]> {
    const res = await this.request<{ reminders?: Reminder[] } | Reminder[]>('/api/v1/reminders');
    return collection<Reminder>(res, 'reminders');
  }

  /**
   * Takes a reminder off the list for good: the Pond has no route that brings
   * one back. A 404 means nothing was waiting under that id for this caller,
   * which includes one somebody else already dismissed.
   */
  async dismissReminder(id: string): Promise<void> {
    await this.post(`/api/v1/reminders/${encodeURIComponent(id)}/dismiss`, {});
  }

  // ── Proposals (shown as "Suggestions") ──────────────────────

  /**
   * The live proposals addressed to this caller, newest first. `sessionId` is
   * required and never defaulted: the Pond answers 400 without it, and 403 when
   * it cannot resolve the caller to exactly one household member.
   */
  async listProposals(sessionId: string): Promise<Proposal[]> {
    const res = await this.get<ProposalList>(`/api/v1/proposals?session_id=${encodeURIComponent(sessionId)}`);
    return res.proposals ?? [];
  }

  /**
   * Accept (`approve`) or decline (`reject`) one proposal. Approving records the
   * decision and executes nothing. 404 covers expired, already decided and
   * unknown alike; 409 is the Pond refusing that status change.
   */
  decideProposal(id: string, sessionId: string, decision: ProposalDecision): Promise<ProposalDecisionResult> {
    return this.post<ProposalDecisionResult>(`/api/v1/proposals/${encodeURIComponent(id)}/decide`, {
      session_id: sessionId,
      decision,
    });
  }

  // ── Memory ──────────────────────────────────────────────────

  /** The household's 50 most recent. The Pond takes no limit or filter. */
  async listMemories(): Promise<MemoryFragment[]> {
    const res = await this.request<{ memories?: MemoryFragment[] } | MemoryFragment[]>('/api/v1/memories');
    return collection<MemoryFragment>(res, 'memories');
  }

  saveMemory(req: SaveMemoryRequest): Promise<MemoryFragment> {
    return this.post<MemoryFragment>('/api/v1/memories', req);
  }

  /** Rewords and/or re-tiers in place; the Pond keeps the id, age, usage and segment. */
  updateMemory(id: string, change: UpdateMemoryRequest): Promise<void> {
    return this.put<void>(`/api/v1/memories/${encodeURIComponent(id)}`, change);
  }

  deleteMemory(id: string): Promise<void> {
    return this.del<void>(`/api/v1/memories/${encodeURIComponent(id)}`);
  }

  // ── Prompt extras ───────────────────────────────────────────

  /** Every note, on or off, in the order the Pond sends them. */
  async listPromptExtras(): Promise<PromptExtra[]> {
    const res = await this.request<{ extras?: PromptExtra[] } | PromptExtra[]>('/api/v1/agent/extras');
    return collection<PromptExtra>(res, 'extras');
  }

  /** Upsert by `key`: the Pond replaces a note already under that key without saying so. */
  savePromptExtra(req: SavePromptExtraRequest): Promise<void> {
    return this.post<void>('/api/v1/agent/extras', req);
  }

  deletePromptExtra(key: string): Promise<void> {
    return this.del<void>(`/api/v1/agent/extras/${encodeURIComponent(key)}`);
  }

  /**
   * Run consolidation now, reporting each stage. Resolves once the run ends,
   * whichever way. A 501 means it is off in the Pond's settings or missing
   * from its build; `ApiError.detail` says which.
   *
   * Only the phone that started a run hears its progress: the Pond has no
   * route that reports a run already going.
   */
  async streamConsolidation(onEvent: (event: ConsolidationEvent) => void, signal?: AbortSignal): Promise<void> {
    const res = await this.open('/api/v1/memory/consolidate', {
      method: 'POST',
      headers: { Accept: 'text/event-stream' },
      signal,
    });
    await readSse(
      res,
      (event) => {
        try {
          onEvent(JSON.parse(event.data) as ConsolidationEvent);
        } catch {
          // A frame that is not JSON carries nothing to act on.
        }
      },
      { idleMs: STREAM_IDLE_MS },
    );
  }

  /** Cancels between stages; a stage already asking a model finishes first. */
  stopConsolidation(): Promise<void> {
    return this.post<void>('/api/v1/memory/consolidate/stop', {});
  }

  // ── Models ──────────────────────────────────────────────────

  /**
   * Every model the Pond has, flattened out of its six category buckets.
   *
   * A Pond with no model repository configured answers the same shape with
   * every bucket empty, so an absent key means "none of that kind" rather than
   * an error. Reading `res.models` here is what crashed the Models screen: the
   * server has never sent that key.
   */
  async listModels(): Promise<ModelEntry[]> {
    const res = await this.request<ModelListResponse>('/api/v1/models');
    return MODEL_CATEGORIES.flatMap((category) =>
      // A bucket that is missing, null or not a list answers nothing rather than
      // throwing: the screen maps over what comes back.
      (Array.isArray(res?.[category]) ? res[category] : []).map((m) => ({
        ...m,
        // The row's own category names the route; the bucket only groups it.
        pond_category: typeof m.category === 'string' && m.category ? m.category : category,
        category,
        id: `${category}:${m.name}`,
      })),
    );
  }

  modelCapabilities(): Promise<ModelCapabilities> {
    return this.get<ModelCapabilities>('/api/v1/models/capabilities');
  }

  activeModelRoles(): Promise<ModelActiveRoles> {
    return this.get<ModelActiveRoles>('/api/v1/models/active-roles');
  }

  modelMemoryStatus(): Promise<ModelMemoryStatus> {
    return this.get<ModelMemoryStatus>('/api/v1/models/memory-status');
  }

  /** Give a model a job. The Pond refuses a request that names no role. */
  activateModel(category: string, name: string, role: ModelRole): Promise<void> {
    return this.post<void>(
      `/api/v1/models/${encodeURIComponent(category)}/${encodeURIComponent(name)}/activate`,
      { role },
    );
  }

  diskUsage(): Promise<DiskUsage> {
    return this.get<DiskUsage>('/api/v1/models/disk-usage');
  }

  async downloadProgress(): Promise<DownloadEntry[]> {
    const res = await this.get<{ downloads?: DownloadEntry[] }>('/api/v1/models/download/progress');
    return Array.isArray(res?.downloads) ? res.downloads : [];
  }

  /** Start fetching a catalogue model. Picture support comes with it unless `pictures` is false. */
  downloadModel(category: string, name: string, pictures: boolean): Promise<unknown> {
    return this.post<unknown>(
      `/api/v1/models/${encodeURIComponent(category)}/${encodeURIComponent(name)}/download`,
      { pictures },
    );
  }

  addPictureSupport(category: string, name: string): Promise<unknown> {
    return this.post<unknown>(
      `/api/v1/models/${encodeURIComponent(category)}/${encodeURIComponent(name)}/companions/pictures`,
      {},
    );
  }

  /** Pause, resume or stop every file of a model's download. */
  controlDownload(modelId: string, action: DownloadAction): Promise<unknown> {
    return this.post<unknown>('/api/v1/models/download/control', { model_id: modelId, action });
  }

  /** Remove a model's file from the Pond. A 409 means it is in use. */
  deleteModel(category: string, name: string): Promise<void> {
    return this.del<void>(`/api/v1/models/${encodeURIComponent(category)}/${encodeURIComponent(name)}`);
  }

  /** The Pond answers a refused search as a 200 with `error`; raise it rather than show no results. */
  async searchModels(query: string): Promise<HfModel[]> {
    const res = await this.get<{ models?: HfModel[]; error?: string }>(
      `/api/v1/models/search/gguf?q=${encodeURIComponent(query)}`,
    );
    if (res?.error) throw new Error(res.error);
    return Array.isArray(res?.models) ? res.models : [];
  }

  async modelFiles(repo: string): Promise<HfModelFile[]> {
    // The Pond passes the repo through unencoded: Hugging Face refuses `owner%2Fname`.
    const res = await this.get<{ files?: HfModelFile[]; error?: string }>(
      `/api/v1/models/search/gguf/files?repo=${repo.split('/').map(encodeURIComponent).join('/')}`,
    );
    if (res?.error) throw new Error(res.error);
    return Array.isArray(res?.files) ? res.files : [];
  }

  downloadModelFile(file: HfModelFile, pictures: boolean): Promise<unknown> {
    return this.post<unknown>('/api/v1/models/download/url', {
      url: file.url,
      category: 'gguf',
      filename: file.filename,
      pictures,
    });
  }

  // ── Schedules ───────────────────────────────────────────────

  async listSchedules(): Promise<Schedule[]> {
    const res = await this.request<{ schedules?: Schedule[] } | Schedule[]>('/api/v1/schedules');
    return collection<Schedule>(res, 'schedules');
  }

  createSchedule(req: CreateScheduleRequest): Promise<Schedule> {
    return this.post<Schedule>('/api/v1/schedules', req);
  }

  updateSchedule(id: string, req: UpdateScheduleRequest): Promise<Schedule> {
    return this.put<Schedule>(`/api/v1/schedules/${encodeURIComponent(id)}`, req);
  }

  deleteSchedule(id: string): Promise<void> {
    return this.del<void>(`/api/v1/schedules/${encodeURIComponent(id)}`);
  }

  pauseSchedule(id: string): Promise<void> {
    return this.post<void>(`/api/v1/schedules/${encodeURIComponent(id)}/pause`, {});
  }

  resumeSchedule(id: string): Promise<void> {
    return this.post<void>(`/api/v1/schedules/${encodeURIComponent(id)}/resume`, {});
  }

  runScheduleNow(id: string): Promise<void> {
    return this.post<void>(`/api/v1/schedules/${encodeURIComponent(id)}/run-now`, {});
  }

  async listScheduleRuns(id: string, limit = 20): Promise<ScheduleRun[]> {
    const res = await this.request<{ runs?: ScheduleRun[] } | ScheduleRun[]>(
      `/api/v1/schedules/${encodeURIComponent(id)}/runs?limit=${limit}`,
    );
    return collection<ScheduleRun>(res, 'runs');
  }

  /**
   * Runs starting and finishing, as the scheduler reports them. Resolves when
   * the stream ends, whichever way; the caller decides whether to reopen it.
   * `onOpen` is called once the Pond has accepted it, which is how a caller
   * that reopens it knows it is back.
   *
   * The Pond takes no stream permit for this one, so holding it open costs no
   * chat stream. A screen that leaves still aborts `signal`: an abandoned
   * stream stays open and keeps delivering to a screen that is gone.
   */
  async streamScheduleEvents(
    onEvent: (event: ScheduleResultEvent) => void,
    signal?: AbortSignal,
    onOpen?: () => void,
  ): Promise<void> {
    const res = await this.open('/api/v1/schedules/events', {
      headers: { Accept: 'text/event-stream' },
      signal,
    });
    onOpen?.();
    await readSse(
      res,
      (event) => {
        try {
          onEvent(JSON.parse(event.data) as ScheduleResultEvent);
        } catch {
          // A frame that is not JSON carries nothing to act on.
        }
      },
      { idleMs: STREAM_IDLE_MS },
    );
  }

  // ── Rules ───────────────────────────────────────────────────
  //
  // Sensor-triggered automations. They live in the scheduler's table but have
  // their own routes, and no run-now: a rule fires when a reading matches.

  async listRules(): Promise<Rule[]> {
    const res = await this.request<{ rules?: Rule[] } | Rule[]>('/api/v1/rules');
    return collection<Rule>(res, 'rules');
  }

  createRule(req: RuleRequest): Promise<Rule> {
    return this.post<Rule>('/api/v1/rules', req);
  }

  updateRule(id: string, req: RuleRequest): Promise<Rule> {
    return this.put<Rule>(`/api/v1/rules/${encodeURIComponent(id)}`, req);
  }

  deleteRule(id: string): Promise<void> {
    return this.del<void>(`/api/v1/rules/${encodeURIComponent(id)}`);
  }

  pauseRule(id: string): Promise<void> {
    return this.post<void>(`/api/v1/rules/${encodeURIComponent(id)}/pause`, {});
  }

  resumeRule(id: string): Promise<void> {
    return this.post<void>(`/api/v1/rules/${encodeURIComponent(id)}/resume`, {});
  }

  // ── Camera events ───────────────────────────────────────────

  /**
   * What one camera saw, newest first. The Pond lists a single camera per call
   * and has no "every camera" read: without `camera_id` it answers for the
   * camera named `default`. `limit` defaults to 20 there and is capped at 100.
   */
  async listCameraEvents(cameraId: string, limit?: number): Promise<CameraEvent[]> {
    const qs = new URLSearchParams({ camera_id: cameraId });
    if (limit) qs.set('limit', String(limit));
    const res = await this.request<{ events?: CameraEvent[] } | CameraEvent[]>(
      `/api/v1/camera/events?${qs.toString()}`,
    );
    return collection<CameraEvent>(res, 'events');
  }

  /**
   * Mark an event as seen. The route reads no body, and answers 200 for an id
   * it has no row for too, since the update simply touches nothing.
   */
  acknowledgeCameraEvent(id: number): Promise<void> {
    return this.request<void>(`/api/v1/camera/events/${encodeURIComponent(String(id))}/acknowledge`, {
      method: 'PATCH',
    });
  }

  // ── Logs and activity ───────────────────────────────────────

  async listLogs(params?: { limit?: number; level?: string }): Promise<LogEntry[]> {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.level) qs.set('level', params.level);
    const q = qs.toString();
    const res = await this.request<{ logs?: LogEntry[] } | LogEntry[]>(
      `/api/v1/logs${q ? `?${q}` : ''}`,
    );
    return collection<LogEntry>(res, 'logs');
  }

  /**
   * The Pond's activity, newest first. `since` is inclusive and `until`
   * exclusive, both RFC3339; there is no cursor, so the next page back is the
   * oldest timestamp seen, passed as `until`. At most 1000 per read.
   */
  listActivity(params?: {
    limit?: number;
    since?: string;
    until?: string;
    category?: EventCategory;
    session_id?: string;
  }): Promise<ActivityResponse> {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.since) qs.set('since', params.since);
    if (params?.until) qs.set('until', params.until);
    if (params?.category) qs.set('category', params.category);
    if (params?.session_id) qs.set('session_id', params.session_id);
    const q = qs.toString();
    return this.get<ActivityResponse>(`/api/v1/activity${q ? `?${q}` : ''}`);
  }

  activitySummary(window?: ActivityWindow): Promise<ActivitySummary> {
    const q = window ? `?window=${encodeURIComponent(window)}` : '';
    return this.get<ActivitySummary>(`/api/v1/activity/summary${q}`);
  }

  /**
   * Delete the household's activity history, all of it. The operational log
   * and telemetry are separate stores and are kept.
   */
  clearActivity(): Promise<ActivityPurge> {
    return this.del<ActivityPurge>('/api/v1/activity');
  }

  /**
   * The operational log as CSV, newest 10,000 rows. The Pond applies no
   * filter to an export, so none is offered here.
   */
  async exportLogsCsv(): Promise<string> {
    const res = await this.open('/api/v1/logs/export', { headers: { Accept: 'text/csv' } });
    return res.text();
  }

  // ── Telemetry ───────────────────────────────────────────────

  telemetrySummary(sessionId: string): Promise<TelemetrySummary> {
    return this.get<TelemetrySummary>(
      `/api/v1/telemetry/summary?session_id=${encodeURIComponent(sessionId)}`,
    );
  }

  /** Every turn of one conversation, first to last. */
  async telemetryTurns(sessionId: string): Promise<TurnMetrics[]> {
    const res = await this.get<{ turns?: TurnMetrics[] } | TurnMetrics[]>(
      `/api/v1/telemetry/turns?session_id=${encodeURIComponent(sessionId)}`,
    );
    return collection<TurnMetrics>(res, 'turns');
  }

  // ── Extensions and the marketplace ──────────────────────────

  async listExtensions(): Promise<Extension[]> {
    const res = await this.request<{ extensions?: Extension[] } | Extension[]>(
      '/api/v1/extensions',
    );
    return collection<Extension>(res, 'extensions');
  }

  /** The Pond routes this path to PATCH and DELETE only; a PUT is refused. */
  setExtensionEnabled(name: string, enabled: boolean): Promise<void> {
    return this.patch<void>(`/api/v1/extensions/${encodeURIComponent(name)}`, { enabled });
  }

  /** `DELETE /extensions/{name}`: stops it and forgets its config. Stored secrets stay. */
  removeExtension(name: string): Promise<void> {
    return this.del<void>(`/api/v1/extensions/${encodeURIComponent(name)}`);
  }

  /**
   * Store an installed extension's credentials, bulk, as `{ KEY: value }`. The Pond
   * also restarts the extension, since a stdio extension's environment is fixed
   * when it is spawned.
   */
  setExtensionSecrets(name: string, secrets: Record<string, string>): Promise<ExtensionSecretsResult> {
    return this.request<ExtensionSecretsResult>(`/api/v1/extensions/${encodeURIComponent(name)}/secrets`, {
      method: 'POST',
      body: JSON.stringify(secrets),
      signal: timeoutSignal(INSTALL_TIMEOUT_MS),
    });
  }

  async listMarketplace(): Promise<MarketplaceExtension[]> {
    const res = await this.get<{ extensions: MarketplaceExtension[] }>('/api/v1/marketplace');
    return res.extensions;
  }

  /**
   * The Pond answers 428 when a required secret is neither in `secrets` nor
   * already stored, so credentials go with the install rather than after it.
   * Its own signal also keeps `request()` from running connection recovery
   * when the long wait runs out.
   */
  installMarketplaceExtension(id: string, secrets?: Record<string, string>): Promise<void> {
    return this.request<void>(`/api/v1/marketplace/${encodeURIComponent(id)}/install`, {
      method: 'POST',
      body: JSON.stringify(secrets ? { secrets } : {}),
      signal: timeoutSignal(INSTALL_TIMEOUT_MS),
    });
  }

  // ── Secrets and OAuth ───────────────────────────────────────

  /**
   * The names of the secrets the pond holds, never their values. The client is
   * deliberately incapable of reading one back: it stores references, and the
   * server keeps the material.
   */
  async listSecretKeys(): Promise<string[]> {
    const res = await this.get<{ keys?: unknown } | null>('/api/v1/secrets');
    const keys = res?.keys;
    // `request<T>` casts whatever it parsed, so a body that is not the listing must not pass as an
    // empty one: that would tell somebody their keys are gone.
    if (!Array.isArray(keys)) throw new Error('The Pond answered the secret listing with something unexpected');
    return keys.filter((key): key is string => typeof key === 'string');
  }

  /**
   * `PUT /secrets/{key}` with `{ value }`: stores or replaces the value, which is never sent back.
   * The Pond then restarts every enabled extension that reads this key, and names the ones that
   * could not restart, so a saved key that nothing is using yet can be said so.
   */
  async setSecret(key: string, value: string): Promise<SecretSaveResult> {
    const res = await this.put<{ restarted?: unknown; restart_errors?: unknown } | null>(
      `/api/v1/secrets/${encodeURIComponent(key)}`,
      { value },
    );
    const restarted = Array.isArray(res?.restarted)
      ? res.restarted.filter((name): name is string => typeof name === 'string')
      : [];
    const errors = res?.restart_errors;
    const restartFailed = errors && typeof errors === 'object' && !Array.isArray(errors) ? Object.keys(errors) : [];
    return { restarted, restartFailed };
  }

  /** `DELETE /secrets/{key}`, a 204. The Pond stops the extensions that cannot run without it. */
  deleteSecret(key: string): Promise<void> {
    return this.del<void>(`/api/v1/secrets/${encodeURIComponent(key)}`);
  }

  async listOAuthProviders(): Promise<OAuthProvider[]> {
    const res = await this.get<{ providers: OAuthProvider[] }>('/api/v1/oauth/providers');
    return res.providers;
  }

  oauthStatus(providerId: string): Promise<{ connected: boolean }> {
    return this.get<{ connected: boolean }>(
      `/api/v1/oauth/status/${encodeURIComponent(providerId)}`,
    );
  }

  // ── Web search ──────────────────────────────────────────────
  // The household's own Brave Search key, held by the Pond. Every route needs the paired token,
  // and none of them returns the key: the phone can set it, check it and remove it, never read it.

  /**
   * Whether the Pond has a key and what Brave last made of it.
   *
   * A body that is not `{configured, status}` throws rather than passing for an answer: the cast in
   * `request` would otherwise hand the screen an `undefined` to index. A Pond without the route
   * answers 404, which the caller reads as "this Pond cannot search the web yet".
   */
  async webSearchState(): Promise<WebSearchState> {
    const state = readWebSearch(await this.get<unknown>('/api/v1/web-search'));
    if (!state) throw new Error('The Pond answered the web search status with something unexpected');
    return state;
  }

  /**
   * Store a Brave key. The Pond checks it with one request to Brave before keeping it, so this
   * takes as long as Brave does, and a key Brave refuses is a 422 with nothing stored.
   *
   * A 200 means the key is stored, so a body that cannot say how it fared is read as `unverified`
   * rather than as a failure that would have somebody paste the same key again.
   */
  async setWebSearchKey(key: string): Promise<WebSearchKeyResult> {
    const state = readWebSearch(await this.put<unknown>('/api/v1/web-search/key', { key }));
    return { configured: true, status: state?.configured ? state.status : 'unverified' };
  }

  /** `DELETE /web-search/key`, a 204. Goose stops being offered the tool on the next turn. */
  removeWebSearchKey(): Promise<void> {
    return this.del<void>('/api/v1/web-search/key');
  }

  // ── Pond settings ───────────────────────────────────────────

  /** The Pond's whole settings record. */
  getSettings(): Promise<PondSettings> {
    return this.get<PondSettings>('/api/v1/settings');
  }

  /**
   * Send only what changed: every key sent is marked as the household's choice for good. Keep the
   * answer, not the patch, since the Pond canonicalises, geocodes and widens what it is sent.
   */
  updateSettings(patch: Partial<PondSettings>): Promise<PondSettings> {
    return this.put<PondSettings>('/api/v1/settings', patch);
  }

  /** Every IANA zone the Pond knows, with its offset now. */
  async listTimeZones(): Promise<ZoneChoice[]> {
    const res = await this.get<{ zones?: ZoneChoice[] }>('/api/v1/time/zones');
    return Array.isArray(res?.zones) ? res.zones : [];
  }

  /** Where the Pond thinks this home is, from a zone or a typed place. Saves nothing. */
  detectLocation(req: { system_zone?: string; typed_name?: string }): Promise<DetectedPlace> {
    return this.post<DetectedPlace>('/api/v1/location/detect', req);
  }

  /** Storing a voice setting waits for the engine to reload; this downloads and switches now. */
  applyTts(change: { voice?: string; speed?: number; quality?: string }): Promise<TtsApplyResult> {
    return this.request<TtsApplyResult>('/api/v1/voice/tts/apply', {
      method: 'POST',
      body: JSON.stringify(change),
      signal: timeoutSignal(TTS_APPLY_TIMEOUT_MS),
    });
  }

  /** Forget the wake word's learned pronunciations. */
  resetWakeWordCalibration(): Promise<void> {
    return this.del<void>('/api/v1/voice/calibrate');
  }

  /** Wake the job that names conversations. It names them as it goes. */
  retitleSessions(): Promise<RetitleResult> {
    return this.post<RetitleResult>('/api/v1/sessions/retitle', {});
  }

  // ── Profiles ────────────────────────────────────────────────

  async listProfiles(): Promise<Profile[]> {
    const res = await this.get<{ profiles: Profile[] }>('/api/v1/profiles');
    return res.profiles;
  }

  createProfile(displayName: string, avatarEmoji?: string): Promise<Profile> {
    return this.post<Profile>('/api/v1/profiles', {
      display_name: displayName,
      avatar_emoji: avatarEmoji,
    });
  }

  deleteProfile(id: string): Promise<void> {
    return this.del<void>(`/api/v1/profiles/${encodeURIComponent(id)}`);
  }

  /** Replaces the member's whole preference map: a key left out is deleted. */
  setProfilePrefs(id: string, preferences: Record<string, string>): Promise<ProfilePrefs> {
    return this.patch<ProfilePrefs>(`/api/v1/profiles/${encodeURIComponent(id)}`, { preferences });
  }

  // ── Owner setup ─────────────────────────────────────────────

  onboardStatus(): Promise<OnboardStatus> {
    return this.get<OnboardStatus>('/api/v1/onboard/status');
  }

  /** Progress only moves forward: recording an earlier step answers the current one unchanged. */
  recordOnboardStep(step: string): Promise<OnboardStatus> {
    return this.post<OnboardStatus>(`/api/v1/onboard/step/${encodeURIComponent(step)}`, {});
  }

  /** A 400 naming `missing_fields` is an answer here, not a failure: it says which steps to revisit. */
  async completeOnboarding(): Promise<OnboardCompletion> {
    try {
      await this.post<unknown>('/api/v1/onboard/complete', {});
      return { completed: true };
    } catch (e) {
      const fields = e instanceof ApiError && e.status === 400 ? (e.body as { missing_fields?: unknown } | null)?.missing_fields : null;
      if (!Array.isArray(fields)) throw e;
      return { completed: false, missing: fields.filter((f): f is string => typeof f === 'string') };
    }
  }

  warmup(): Promise<WarmupStatus> {
    return this.get<WarmupStatus>('/api/v1/warmup');
  }

  /** One take of the wake phrase, recorded on this phone; the Pond transcribes it and keeps what it heard. */
  async calibrateWakeWord(fileUri: string, prompt: string): Promise<CalibrationTake> {
    const form = new FormData();
    form.append('audio', new File(fileUri), 'sample.wav');
    form.append('prompt', prompt);
    const res = await this.send(`${this.baseUrl}/api/v1/voice/calibrate`, {
      method: 'POST',
      // No Content-Type: the runtime writes the multipart boundary itself.
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      body: form,
      signal: timeoutSignal(VOICE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await errorBody(res);
      throw new ApiError(`POST /api/v1/voice/calibrate → ${res.status}`, res.status, parseRetryAfter(res), detailOf(body), body);
    }
    return (await res.json()) as CalibrationTake;
  }

  /**
   * Have the Pond say a short sample in `voice` on its own speaker (goose-in-a-pond#579, P4): the way
   * to hear a voice during setup, when `/tts` answers loopback only. A 202 means it is speaking;
   * refusals are 404 `unknown_voice`, 429 with Retry-After, and 503 `voice_unavailable`. An older Pond
   * answers 404 with no code, having no such route.
   */
  async voiceSample(voice: string): Promise<void> {
    await this.post<unknown>('/api/v1/voice/sample', { voice });
  }

  /** Which household member this device belongs to, as the Pond sees it. */
  deviceSelf(): Promise<DeviceSelf> {
    return this.get<DeviceSelf>('/api/v1/devices/self');
  }

  /** The Pond's own description of itself: hostname and version. */
  systemInfo(): Promise<SystemInfo> {
    return this.get<SystemInfo>('/api/v1/system/info');
  }

  /** Outdoor weather where the Pond is configured to be, in Celsius. */
  weather(): Promise<WeatherResponse> {
    return this.get<WeatherResponse>('/api/v1/weather');
  }

  /** What Spotify is playing, as the Pond reports it. */
  nowPlaying(): Promise<NowPlayingResponse> {
    return this.get<NowPlayingResponse>('/api/v1/music/now-playing');
  }

  /** Active schedules, soonest first. The Pond sends a bare array; an envelope is tolerated. */
  async upcomingSchedules(limit: number): Promise<UpcomingSchedule[]> {
    const res = await this.get<{ schedules: UpcomingSchedule[] } | UpcomingSchedule[]>(
      `/api/v1/schedules/upcoming?limit=${encodeURIComponent(String(limit))}`,
    );
    return Array.isArray(res) ? res : res.schedules;
  }

  // ── Rides ───────────────────────────────────────────────────
  // The Pond knows whose ride it is from this phone's pairing; no request names a member.

  /** An upfront fare from where the phone is. Books nothing. */
  quoteRide(pickup: Omit<RidePoint, 'name'> & { name?: string }, dropoff: RidePoint): Promise<RideQuote> {
    return this.post<RideQuote>('/api/v1/rides/quote', { pickup, dropoff });
  }

  getRide(id: string): Promise<RideQuote> {
    return this.get<RideQuote>(`/api/v1/rides/${encodeURIComponent(id)}`);
  }

  /** Book the ride at the quoted fare. A fare is confirmed at most once. */
  confirmRide(id: string): Promise<RideQuote> {
    return this.post<RideQuote>(`/api/v1/rides/${encodeURIComponent(id)}/confirm`, {});
  }

  declineRide(id: string): Promise<void> {
    return this.post<void>(`/api/v1/rides/${encodeURIComponent(id)}/decline`, {});
  }

  /** Cancel a booked ride. The ride company may charge a cancellation fee. */
  cancelRide(id: string): Promise<void> {
    return this.post<void>(`/api/v1/rides/${encodeURIComponent(id)}/cancel`, {});
  }

  // ── Verb helpers ────────────────────────────────────────────

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  /**
   * Tell the Pond this device is still here.
   *
   * The Pond derives `is_online` at read time from `last_seen` against a
   * five-minute threshold, and nothing refreshes a phone's row after pairing
   * writes it once -- so the row ages out and the phone's own card reports
   * "offline" while the app is open and in use. That is the one direction the
   * answer must not be wrong in: offline is what somebody opens this screen to
   * check.
   *
   * The route already exists on the Pond and had no caller.
   */
  deviceHeartbeat(deviceId: string): Promise<void> {
    return this.post<void>(`/api/v1/devices/${encodeURIComponent(deviceId)}/heartbeat`, {});
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  private put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  private patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  private del<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

/** Singleton instance */
export const api = new PondApiClient();
