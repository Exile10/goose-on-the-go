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
 * Reconnects with capped exponential backoff until `stop()` is called.
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
  /** Called when the stream drops and a reconnect is scheduled. */
  onDisconnect?: () => void;
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
  const frames = chunk.split('\n\n');
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

export class NotificationStream {
  private opts: StreamOptions;
  private xhr: XMLHttpRequest | null = null;
  private stopped = false;
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private seenIds: string[] = [];
  private seenSet = new Set<string>();

  constructor(opts: StreamOptions) {
    this.opts = opts;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  /** Tear down the connection and cancel any pending reconnect. */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.xhr?.abort();
    this.xhr = null;
  }

  private connect(): void {
    if (this.stopped) return;

    const { baseUrl, deviceId, token } = this.opts;
    const url = `${baseUrl}/api/v1/notifications/stream?device_id=${encodeURIComponent(deviceId)}`;

    const xhr = new XMLHttpRequest();
    this.xhr = xhr;
    let consumed = 0;
    let partial = '';

    xhr.open('GET', url);
    xhr.setRequestHeader('Accept', 'text/event-stream');
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
      if (this.stopped) return;
      this.opts.onDisconnect?.();
      this.reconnectTimer = setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    };
    xhr.onerror = scheduleReconnect;
    xhr.onload = scheduleReconnect; // server closed the stream → reconnect
    xhr.ontimeout = scheduleReconnect;

    xhr.send();
  }

  private handleFrame(data: string): void {
    let parsed: ServerNotification;
    try {
      parsed = JSON.parse(data) as ServerNotification;
    } catch {
      return; // keep-alive / non-JSON frame
    }
    if (!parsed.id || this.seenSet.has(parsed.id)) return;
    this.seenSet.add(parsed.id);
    this.seenIds.push(parsed.id);
    if (this.seenIds.length > DEDUPE_CAPACITY) {
      const evicted = this.seenIds.shift();
      if (evicted) this.seenSet.delete(evicted);
    }
    this.opts.onNotification(parsed);
  }
}
