/**
 * The arithmetic of talking to the Pond: sound in, sound out, and the text in
 * between.
 *
 * Nothing here touches a native module, so all of it can be tested. The voice
 * view-model feeds it microphone buffers and reply text; `api-client.ts` does
 * the sending.
 *
 * The Pond's speech-to-text reads WAV and nothing else — it sniffs the RIFF
 * header and rejects AAC, Opus or WebM with a 500 — and Android's recorder
 * cannot write WAV at all. So the app does not record files. It takes raw PCM
 * from the microphone, measures it for the orb and the end of speech, and
 * writes the WAV itself, the same 16 kHz 16-bit mono pond-desktop sends.
 */

/** What Whisper is fed. Anything else is resampled on the Pond anyway. */
export const SPEECH_RATE = 16_000;

/**
 * Loudness thresholds, as RMS amplitude on a 0..1 scale — pond-desktop's own
 * (`useVoicePipeline.ts`): speech has begun once the level holds at or above
 * `SPEECH_START` for 60ms, and ended after `SILENCE_MS` below `SPEECH_END`.
 * The gap between the two is the hysteresis that keeps a breath from ending a
 * sentence.
 */
export const SPEECH_START = 0.01;
export const SPEECH_END = 0.005;
export const SPEECH_HOLD_MS = 60;
/**
 * The desktop's 400ms is a desk microphone's number. A phone held at arm's
 * length hears more room and more hesitation, and cutting someone off
 * mid-thought is the worse failure, so it waits a little longer.
 */
export const SILENCE_MS = 700;
/** Past this a clip also passes the Pond's 2 MiB upload limit at 16 kHz. */
export const MAX_SPEECH_MS = 30_000;

/** Root-mean-square level of 16-bit samples, on a 0..1 scale. */
export function rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i] / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * The orb's reading of a level: the raw loudness times six, capped at one —
 * pond-desktop's scaling, so the orb moves the same amount for the same voice.
 */
export function orbLevel(level: number): number {
  return Math.min(1, level * 6);
}

/**
 * Bring samples to `SPEECH_RATE` by averaging each window.
 *
 * Averaging rather than picking every nth sample, because picking folds
 * everything above 8 kHz back into the band Whisper listens to. A box filter is
 * a crude low-pass, but it is the difference between hiss and aliased mush.
 */
export function downsample(samples: Int16Array, fromRate: number, toRate = SPEECH_RATE): Int16Array {
  if (fromRate === toRate) return samples;
  if (fromRate < toRate) {
    // Upsampling a clip that is already too thin gains nothing; send it as is
    // and say so in the header rather than inventing samples.
    return samples;
  }
  const ratio = fromRate / toRate;
  const out = new Int16Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += samples[j];
    out[i] = Math.round(sum / Math.max(1, end - start));
  }
  return out;
}

/** Mono 16-bit PCM wrapped in the 44-byte RIFF header the Pond sniffs for. */
export function encodeWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) out[at + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  new Int16Array(out.buffer, 44, samples.length).set(samples);
  return out;
}

/** Join captured buffers into one run of samples. */
export function concatSamples(chunks: Int16Array[]): Int16Array {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Int16Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * How loud a WAV is over time, in `stepMs` windows, for the orb while Goose
 * speaks.
 *
 * Read from the bytes the Pond sent rather than from the player, because the
 * sound is already in hand and a player's sampling callback is one more native
 * path to go quiet on a device. Returns an empty envelope for anything that is
 * not 16-bit PCM, which the orb reads as a steady speaking glow.
 */
export function envelope(wav: Uint8Array, stepMs = 50): { stepMs: number; levels: number[] } {
  if (wav.length < 44) return { stepMs, levels: [] };
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return { stepMs, levels: [] };

  let at = 12;
  let rate = 0;
  let bits = 0;
  let channels = 1;
  while (at + 8 <= wav.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
    } else if (id === 'data') {
      if (bits !== 16 || rate === 0) return { stepMs, levels: [] };
      const start = at + 8;
      const end = Math.min(wav.length, start + size);
      const frames = Math.floor((end - start) / (2 * channels));
      const perStep = Math.max(1, Math.floor((rate * stepMs) / 1000));
      const levels: number[] = [];
      for (let f = 0; f < frames; f += perStep) {
        let sum = 0;
        let n = 0;
        for (let k = f; k < Math.min(frames, f + perStep); k += 1) {
          const s = view.getInt16(start + k * 2 * channels, true) / 32768;
          sum += s * s;
          n += 1;
        }
        levels.push(Math.sqrt(sum / Math.max(1, n)));
      }
      return { stepMs, levels };
    }
    at += 8 + size + (size % 2);
  }
  return { stepMs, levels: [] };
}

/**
 * What a speaker should say of a reply: no markdown, no symbols read aloud.
 *
 * pond-desktop cleans each sentence the same way before `/tts`. A voice reading
 * "asterisk asterisk" or a URL character by character is worse than one that
 * skips them.
 */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^[#>\s]*[-*+]\s+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split off the sentences a streaming reply has finished.
 *
 * Returns the complete ones and how far into `text` they reach, so the caller
 * can hand each to `/tts` as soon as it is whole instead of waiting for the
 * answer to end — synthesis only starts once it has a sentence, and a reply
 * spoken a sentence at a time starts speaking seconds sooner. `final` flushes
 * whatever is left when the turn is done.
 */
export function takeSentences(
  text: string,
  from: number,
  final = false,
): { sentences: string[]; next: number } {
  const sentences: string[] = [];
  let start = from;
  // A sentence ends at . ! ? or a line break, followed by space or the end —
  // "3.5" and "e.g.x" do not end one.
  const boundary = /[.!?…]+["')\]]*(?=\s|$)|\n+/g;
  boundary.lastIndex = from;
  for (let m = boundary.exec(text); m; m = boundary.exec(text)) {
    const end = m.index + m[0].length;
    // At the very end of a streaming text the boundary may be a decimal point
    // or an abbreviation still being written; wait for what follows.
    if (!final && end >= text.length) break;
    const sentence = speakable(text.slice(start, end));
    if (sentence.length > 0) sentences.push(sentence);
    start = end;
  }
  if (final) {
    const rest = speakable(text.slice(start));
    if (rest.length > 0) sentences.push(rest);
    start = text.length;
  }
  return { sentences, next: start };
}
