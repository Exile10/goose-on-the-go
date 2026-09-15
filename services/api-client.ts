/**
 * PondApiClient — HTTP client for goose-in-a-pond.
 *
 * Implements the GIAP ↔ GOTG handshake protocol:
 *   1. handshakeInit  — POST /api/v1/handshake/init     → challenge
 *   2. pair           — runs init + verify with a 6-digit code
 *   3. handshakeRefresh                                 → fresh tokens
 *
 * The active session token is automatically attached to every request as
 * `Authorization: Bearer <token>`. On 401, the client tries one refresh
 * before bubbling the error up to the caller.
 */

import { concat, fromBase64, hmacSha256, toHex, utf8 } from './hmac';

/**
 * A non-2xx response, carrying the pieces a caller needs to react properly —
 * chiefly the status and, on a 429, how long the server asked us to wait.
 * Without `retryAfterSecs` a caller can only guess, and guessing badly is how
 * a client ends up hammering an endpoint it has already been throttled on.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterSecs: number | null;

  constructor(message: string, status: number, retryAfterSecs: number | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterSecs = retryAfterSecs;
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
}

interface ChallengeResponse {
  challenge_id: string;
  challenge: string; // base64
  expires_at: string;
}

/** How long to wait for /health before calling the Pond unreachable. */
const HEALTH_TIMEOUT_MS = 3_000;

/**
 * `AbortSignal.timeout()` stand-in.
 *
 * React Native installs abort-controller@3's `AbortSignal` as the global
 * (react-native/Libraries/Core/setUpXHR.js), and that implementation carries no
 * static methods at all — `AbortSignal.timeout` is `undefined` on device. Calling
 * it threw a TypeError that `health()` then swallowed in its own catch, so the
 * probe reported every Pond unreachable and never once returned ok.
 */
function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export class PondApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private refreshToken: string | null = null;
  /** Called after a refresh succeeds so the caller can re-persist the pair. */
  private onTokensRotated: ((session: string, refresh: string) => void) | null = null;

  constructor(baseUrl = 'http://127.0.0.1:4000') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
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
  async health(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        headers: this.headers(),
        signal: timeoutSignal(HEALTH_TIMEOUT_MS),
      });
      return { ok: res.ok, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  /** Phase 1: ask the server for a fresh challenge. */
  async handshakeInit(input: {
    clientId: string;
    clientType?: string;
    clientVersion?: string;
  }): Promise<ChallengeResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/handshake/init`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        client_id: input.clientId,
        client_type: input.clientType ?? 'gotg',
        client_version: input.clientVersion ?? '1.0.0',
      }),
    });
    if (!res.ok) {
      throw new ApiError(
        `handshake/init failed: ${res.status}`,
        res.status,
        parseRetryAfter(res),
      );
    }
    return (await res.json()) as ChallengeResponse;
  }

  /** Phase 2: prove possession of the pairing code. */
  async handshakeVerify(input: {
    challengeId: string;
    mac: string;
    deviceName?: string;
  }): Promise<HandshakeResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/handshake/verify`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        challenge_id: input.challengeId,
        mac: input.mac,
        device_name: input.deviceName ?? null,
      }),
    });
    if (!res.ok) {
      throw new ApiError(
        `handshake/verify failed: ${res.status}`,
        res.status,
        parseRetryAfter(res),
      );
    }
    return (await res.json()) as HandshakeResponse;
  }

  /**
   * Run the full two-phase pairing. On success the session+refresh tokens
   * are stored on this client (use {@link setOnTokensRotated} to persist).
   */
  async pair(input: {
    clientId: string;
    pairingCode: string;
    deviceName?: string;
  }): Promise<HandshakeResponse> {
    const init = await this.handshakeInit({ clientId: input.clientId });
    const challenge = fromBase64(init.challenge);
    const message = concat(challenge, utf8(input.clientId));
    const mac = toHex(hmacSha256(utf8(input.pairingCode), message));
    const resp = await this.handshakeVerify({
      challengeId: init.challenge_id,
      mac,
      deviceName: input.deviceName,
    });
    if (resp.accepted && resp.session_token) {
      this.token = resp.session_token;
      this.refreshToken = resp.refresh_token ?? null;
      if (resp.refresh_token && this.onTokensRotated) {
        this.onTokensRotated(resp.session_token, resp.refresh_token);
      }
    }
    return resp;
  }

  /** Exchange the stored refresh token for a fresh pair. */
  async handshakeRefresh(): Promise<HandshakeResponse | null> {
    if (!this.refreshToken) return null;
    const res = await fetch(`${this.baseUrl}/api/v1/handshake/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.refreshToken }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as HandshakeResponse;
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
    await fetch(`${this.baseUrl}/api/v1/handshake/revoke`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ token: this.token }),
    });
    this.token = null;
    this.refreshToken = null;
  }

  /**
   * Wrapper around `fetch` that attaches the bearer token and transparently
   * refreshes once on 401. Returns the parsed JSON body.
   */
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const doFetch = () =>
      fetch(url, {
        ...init,
        headers: { ...this.headers(), ...(init.headers ?? {}) },
      });
    let res = await doFetch();
    if (res.status === 401 && this.refreshToken) {
      const refreshed = await this.handshakeRefresh();
      if (refreshed?.accepted) res = await doFetch();
    }
    if (!res.ok) {
      // Message format unchanged — existing logs stay readable.
      throw new ApiError(
        `${init.method ?? 'GET'} ${path} → ${res.status}`,
        res.status,
        parseRetryAfter(res),
      );
    }
    return (await res.json()) as T;
  }
}

/** Singleton instance */
export const api = new PondApiClient();
