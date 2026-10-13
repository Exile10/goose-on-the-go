import { assertPondTrust } from './pond-trust';
/**
 * NotificationStream — consumes GIAP's `GET /api/v1/notifications/stream`
 * (SSE) so the phone receives server notifications in the foreground:
 * schedule results, security alerts ("Failed pairing attempt"), and anything
 * the assistant pushes via its notification tool.
 *
 * The server contract (#99):
 *   - `?device_id=<installId>` — the id this install paired with (the server
 *     registered the device under our `client_id`).
 *   - On connect it first flushes notifications queued while we were offline,
 *     then tails live broadcasts. Every notification carries a stable `id`;
 *     we dedupe on it, so the flush/live race is harmless.
 *
 * React Native's `fetch` cannot stream response bodies, so this parses SSE
 * frames incrementally off `XMLHttpRequest.onprogress` — no added dependency.
 * Reconnects with exponential backoff, from 1 s and capped at 30 s, until
 * `stop()` is called or the Pond answers 401. A 401 stops the stream and hands
 * the token back through `onAuthFailure`. A 403 is a refusal to serve the stream
 * yet, such as before onboarding completes, not a dead token, and is retried.
 */

export interface ServerNotification {
  id: string;
  /** Target device id, or "broadcast". */
  target: string;
  /** "alert" | "info" | "action_required" */
  category: string;
  title: string;
  body: string;
  timestamp: string;
  data?: unknown;
}

interface StreamOptions {
  baseUrl: string;
  deviceId: string;
  token: string;
  onNotification: (n: ServerNotification) => void;
  deduplicator?: NotificationDeduplicator;
  /** Called when the stream drops and a reconnect is scheduled. */
  onDisconnect?: () => void;
  /**
   * Called when the server rejected the token itself (401). The stream has
   * stopped and will not retry: only a fresh token can recover it.
   */
  onAuthFailure?: () => void;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
/** Ids remembered for dedupe; old entries are evicted FIFO. */
const DEDUPE_CAPACITY = 200;

/** Parse complete SSE frames out of `chunk`, returning any trailing partial
 * frame to carry into the next read. Exported for tests. */
export function parseSseChunk(
  chunk: string,
  emit: (data: string) => void,
): string {
  // Normalise CRLF first: under strict '\r\n\r\n' framing no bare '\n\n'
  // ever appears, so splitting on it alone emits nothing at all and grows
  // the carried remainder without bound. The spec permits either form.
  const frames = chunk.replace(/\r\n/g, '\n').split('\n\n');
  const remainder = frames.pop() ?? '';
  for (const frame of frames) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data.length > 0) emit(data);
  }
  return remainder;
}

/** Shared across stream instances so roaming cannot present a notification twice. */
export class NotificationDeduplicator {
  private ids = new Set<string>();
  accept(id: string): boolean {
    if (!id || this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > DEDUPE_CAPACITY) this.ids.delete(this.ids.values().next().value!);
    return true;
  }
}

export class NotificationStream {
  private opts: StreamOptions;
  private xhr: XMLHttpRequest | null = null;
  private stopped = false;
  private generation = 0;
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private deduplicator: NotificationDeduplicator;

  constructor(opts: StreamOptions) {
    this.opts = opts;
    this.deduplicator = opts.deduplicator ?? new NotificationDeduplicator();
  }

  start(): void {
    this.stopped = false;
    this.generation++;
    void this.connect();
  }

  /** Tear down the connection and cancel any pending reconnect. */
  stop(): void {
    this.stopped = true;
    this.generation++;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.xhr?.abort();
    this.xhr = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    const generation = this.generation;
    const { baseUrl, deviceId, token } = this.opts;
    try { await assertPondTrust(baseUrl); }
    catch { if (!this.stopped && generation === this.generation) this.retryLater(generation); return; }
    if (this.stopped || generation !== this.generation) return;
    const url = `${baseUrl}/api/v1/notifications/stream?device_id=${encodeURIComponent(deviceId)}`;

    const xhr = new XMLHttpRequest();
    this.xhr = xhr;
    let consumed = 0;
    let partial = '';

    xhr.open('GET', url);
    xhr.setRequestHeader('Accept', 'text/event-stream');
    xhr.setRequestHeader('X-Pond-Transport', '1');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.onprogress = () => {
      // A streaming read means the connection is healthy — reset backoff.
      this.backoffMs = INITIAL_BACKOFF_MS;
      const text = xhr.responseText;
      const fresh = text.slice(consumed);
      consumed = text.length;
      partial = parseSseChunk(partial + fresh, (data) => this.handleFrame(data));
    };

    const scheduleReconnect = () => {
      if (!this.stopped && generation === this.generation) this.retryLater(generation);
    };
    xhr.onerror = scheduleReconnect;
    xhr.onload = () => {
      // The token is captured once at construction and never refreshed here, so
      // a 401 means every reconnect would replay the same dead credential
      // forever behind capped backoff, with nothing surfacing that notifications
      // had stopped. Stop, and tell the caller — it owns the token.
      if (xhr.status === 401) {
        this.stop();
        this.opts.onAuthFailure?.();
        return;
      }
      // A 403 is not about the token: the Pond answers 401 for a token it does not
      // accept, and 403 for a request it understood and will not serve yet, such as
      // before onboarding completes. Treated as a dead token, it sent the owner to
      // refresh -- which succeeded, since the token was fine -- and then to reconnect
      // loudly, which restarted this stream into the same 403: about ten rounds a
      // second, each spending a refresh token, on a Pond that was not yet onboarded
      // (2026-10-05). Retried with the usual backoff instead, which reaches 30 s.
      if (xhr.status === 403) {
        console.warn('[notifications] the Pond refused the stream (403); retrying with backoff:', xhr.responseText.slice(0, 200));
      }
      scheduleReconnect(); // server closed the stream → reconnect
    };
    xhr.ontimeout = scheduleReconnect;

    xhr.send();
  }

  /**
   * Tell the owner the stream dropped, then come back on our own after a backoff.
   *
   * Both, not either. The owner may move to another endpoint, and its cleanup
   * stops this stream, which cancels the timer. But a recovery that finds the
   * same endpoint changes nothing the owner reacts to, so a stream that only
   * reported the drop and stopped stayed dead until the app was backgrounded.
   */
  private retryLater(generation: number): void {
    this.opts.onDisconnect?.();
    if (this.stopped || generation !== this.generation) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (generation === this.generation) void this.connect();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  private handleFrame(data: string): void {
    let parsed: ServerNotification;
    try {
      parsed = JSON.parse(data) as ServerNotification;
    } catch {
      return; // keep-alive / non-JSON frame
    }
    if (!this.deduplicator.accept(parsed.id)) return;
    this.opts.onNotification(parsed);
  }
}
