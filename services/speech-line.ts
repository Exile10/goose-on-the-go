/**
 * The clauses of a spoken reply on their way to the speaker. Each is sent to
 * `render` (the Pond's `/tts`) while earlier ones play, and comes back in the
 * order it was queued, whatever order the renders finish in.
 */

export type Render = (text: string, signal: AbortSignal) => Promise<ArrayBuffer>;

export interface SpeechLineLimits {
  /** Requests the Pond has not answered yet. */
  inFlight: number;
  /** Clauses sent and not yet handed to the speaker, answered or not. */
  buffered: number;
}

/**
 * The Pond renders `/tts` one request at a time, so two in flight keep it busy;
 * a third would only wait in its queue and could pass the request's 45 s
 * ceiling on a long sentence. Rendered clauses waiting to play are held in
 * memory, so a fast Pond stops after four.
 */
export const TTS_LIMITS: SpeechLineLimits = { inFlight: 2, buffered: 4 };

export interface SpeechLine {
  /** Queues clauses, and sends as many as the limits allow. */
  push(units: readonly string[]): void;
  /** The next clause's audio, in order; null when nothing is queued or sent. */
  next(): Promise<ArrayBuffer> | null;
  /** Clauses queued, rendering, or rendered and waiting for the speaker. */
  readonly pending: number;
  /** Cancels every request in flight and forgets the rest. */
  clear(): void;
}

export function createSpeechLine(render: Render, limits: SpeechLineLimits): SpeechLine {
  let queue: string[] = [];
  let sent: Promise<ArrayBuffer>[] = [];
  let unanswered = 0;
  let cancel: AbortController | null = null;
  // A cleared request still settles later; it must not count against the line that replaced it.
  let epoch = 0;

  const fill = () => {
    while (unanswered < limits.inFlight && sent.length < limits.buffered && queue.length > 0) {
      cancel ??= new AbortController();
      const audio = render(queue.shift() as string, cancel.signal);
      const mine = epoch;
      unanswered += 1;
      const settle = () => {
        if (mine !== epoch) return;
        unanswered -= 1;
        fill();
      };
      // A cleared clause is not an error; the one `next` hands out still throws there.
      audio.then(settle, settle);
      sent.push(audio);
    }
  };

  return {
    push(units) {
      queue.push(...units);
      fill();
    },
    next() {
      fill();
      const audio = sent.shift() ?? null;
      fill();
      return audio;
    },
    get pending() {
      return queue.length + sent.length;
    },
    clear() {
      cancel?.abort();
      cancel = null;
      epoch += 1;
      unanswered = 0;
      queue = [];
      sent = [];
    },
  };
}
