/**
 * The units of a spoken reply on their way to the speaker. Each is sent to
 * `render` (the Pond's `/tts`) while earlier ones play, and comes back in the
 * order it was queued, whatever order the renders finish in.
 */

import { holdSeconds, type SpeechUnit } from '@/services/speech';

export type Render = (unit: SpeechUnit, signal: AbortSignal) => Promise<ArrayBuffer>;

export interface SpeechLineLimits {
  /** Requests the Pond has not answered yet. */
  inFlight: number;
  /** Units sent and not yet handed to the speaker, answered or not. */
  buffered: number;
}

/**
 * The Pond renders `/tts` one request at a time, so two in flight keep it busy;
 * a third would only wait in its queue and could pass the request's 45 s
 * ceiling on a long unit. Rendered units waiting to play are held in memory,
 * so a fast Pond stops after four.
 */
export const TTS_LIMITS: SpeechLineLimits = { inFlight: 2, buffered: 4 };

/** The longest a unit is held: past this a rate measured on one odd request is not believed. */
const LONGEST_HOLD_SECONDS = 20;

export interface SpeechLine {
  /** Queues units, and sends as many as the limits allow. */
  push(units: readonly SpeechUnit[]): void;
  /** The next unit's audio, in order; null when nothing is queued or sent. */
  next(): Promise<ArrayBuffer> | null;
  /**
   * Seconds to wait before playing the audio `next` last handed out, which runs
   * `readySeconds`, so the units behind it follow without a gap. Asked only of
   * audio that starts from silence: `afterSilence`, or a unit the speaker had
   * to wait for.
   */
  hold(readySeconds: number, afterSilence: boolean): number;
  /** Units queued, rendering, or rendered and waiting for the speaker. */
  readonly pending: number;
  /** Cancels every request in flight and forgets the rest. */
  clear(): void;
}

interface Sent {
  audio: Promise<ArrayBuffer>;
  chars: number;
  /** Seconds of audio the Pond answered with; null until it has, 0 when it failed. */
  seconds: number | null;
}

/**
 * `seconds` measures an answer's audio; `now` is the clock, in ms. A request
 * sent with none other in flight times the Pond's Kokoro: how long it works,
 * and how long the result plays, for each character.
 */
export function createSpeechLine(
  render: Render,
  limits: SpeechLineLimits,
  seconds: (audio: ArrayBuffer) => number = () => 0,
  now: () => number = Date.now,
): SpeechLine {
  let queue: SpeechUnit[] = [];
  let sent: Sent[] = [];
  let unanswered = 0;
  let cancel: AbortController | null = null;
  // A cleared request still settles later; it must not count against the line that replaced it.
  let epoch = 0;
  let rate: { synth: number; speech: number } | null = null;
  let waitedForLast = false;

  const fill = () => {
    while (unanswered < limits.inFlight && sent.length < limits.buffered && queue.length > 0) {
      cancel ??= new AbortController();
      const unit = queue.shift() as SpeechUnit;
      const alone = unanswered === 0;
      const sentAt = now();
      const entry: Sent = { audio: render(unit, cancel.signal), chars: unit.text.length, seconds: null };
      const mine = epoch;
      unanswered += 1;
      const settle = (audio: ArrayBuffer | null) => {
        entry.seconds = audio ? seconds(audio) : 0;
        if (mine !== epoch) return;
        if (alone && entry.seconds > 0 && entry.chars > 0) {
          rate = { synth: (now() - sentAt) / 1000 / entry.chars, speech: entry.seconds / entry.chars };
        }
        unanswered -= 1;
        fill();
      };
      // A cleared unit is not an error; the one `next` hands out still throws there.
      entry.audio.then(settle, () => settle(null));
      sent.push(entry);
    }
  };

  return {
    push(units) {
      queue.push(...units);
      fill();
    },
    next() {
      fill();
      const entry = sent.shift() ?? null;
      waitedForLast = entry !== null && entry.seconds === null;
      fill();
      return entry?.audio ?? null;
    },
    hold(readySeconds, afterSilence) {
      if (!rate || !(afterSilence || waitedForLast)) return 0;
      const { synth, speech } = rate;
      const owed = [
        ...sent.map((s): [number, number] => (s.seconds === null ? [s.chars * synth, s.chars * speech] : [0, s.seconds])),
        ...queue.map((u): [number, number] => [u.text.length * synth, u.text.length * speech]),
      ];
      return Math.min(holdSeconds(readySeconds, owed), LONGEST_HOLD_SECONDS);
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
      waitedForLast = false;
    },
  };
}
