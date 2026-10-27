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
 * The Pond's Kokoro renders each `/tts` request whole, at about real time, so
 * the first sound waits on the length of the first thing sent. These are the
 * limits of the Pond's own voice loop (`split_speech_units` in pond-voice), and
 * a cap on the first unit for when no clause mark comes.
 */
const MIN_CLAUSE_WORDS = 3;
const FIRST_UNIT_MAX_WORDS = 6;
const MAX_UNIT_CHARS = 250;

const TERMINALS = '.!?…';
const CLAUSE_MARKS = ',;:—';
const CLOSERS = `"')]”’`;

/** pond-voice's list: a full stop after one of these, or after a single letter, ends no sentence. */
const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'jr', 'sr', 'vs', 'etc', 'approx', 'dept', 'govt', 'inc',
  'ltd', 'corp', 'min', 'max', 'temp', 'est', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug',
  'sep', 'sept', 'oct', 'nov', 'dec', 'e.g', 'i.e', 'u.s', 'a.m', 'p.m',
]);

/** Something a voice would say, as opposed to punctuation or markup alone. */
const SAYABLE = /[^\s.,;:!?…—–'"“”‘’()[\]{}*_~#>|`-]/;

function isAbbreviation(word: string): boolean {
  const clean = word.replace(/^[^A-Za-z0-9]+/, '').toLowerCase();
  return /^[a-z]$/.test(clean) || ABBREVIATIONS.has(clean);
}

/**
 * Whether the run of terminals from `at` to `end`, after `word`, closes a
 * sentence. It need not wait for the next token, except where that token could
 * still make it a decimal ("25." then "3") or part of a link.
 */
function endsSentence(text: string, word: string, at: number, end: number): boolean {
  const streaming = end >= text.length;
  if (!streaming && !/\s/.test(text[end])) return false;
  if (text[at] === '.' && end - at === 1) {
    if (isAbbreviation(word)) return false;
    if (streaming && /\d$/.test(word)) return false;
  }
  return !(streaming && /:\/\/|^www\./i.test(word));
}

/**
 * Split off the parts of a streaming reply that are ready to be spoken.
 *
 * Returns them and how far into `text` they reach, so the caller can hand each
 * to `/tts` while the reply is still being written. The first ends at a clause
 * mark once it has three words, or after six words when none comes; later ones
 * at a clause or a sentence. `final` flushes whatever is left when the turn is
 * done.
 */
export function takeSpeechUnits(
  text: string,
  from: number,
  final = false,
): { units: string[]; next: number } {
  const units: string[] = [];
  let start = from;
  let first = !SAYABLE.test(speakable(text.slice(0, from)));
  let words = 0;
  let wordAt = -1;
  // Inside a link or inline code; a clause cut there leaves speakable() half of it.
  let nesting = 0;
  let inCode = false;
  let fenced = false;

  const cut = (end: number) => {
    const unit = speakable(text.slice(start, end));
    if (SAYABLE.test(unit)) {
      units.push(unit);
      first = false;
    }
    start = end;
    words = 0;
    wordAt = -1;
    nesting = 0;
    inCode = false;
  };
  // A word counts once something follows it: "sun" may yet become "sunny".
  const wordsBefore = (i: number) =>
    words + (wordAt >= 0 && SAYABLE.test(text.slice(wordAt, i)) ? 1 : 0);

  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    // speakable() can only drop a code block it sees whole.
    if (text.startsWith('```', i)) {
      fenced = !fenced;
      i += 2;
      continue;
    }
    if (fenced) continue;

    if (/\s/.test(c)) {
      words = wordsBefore(i);
      wordAt = -1;
      if (c === '\n') cut(i + 1);
      else if (
        (first && words >= FIRST_UNIT_MAX_WORDS && nesting === 0 && !inCode) ||
        i - start >= MAX_UNIT_CHARS
      ) {
        cut(i);
      }
      continue;
    }
    if (wordAt < 0) wordAt = i;

    if (c === '[' || c === '(') nesting += 1;
    else if ((c === ']' || c === ')') && nesting > 0) nesting -= 1;
    else if (c === '`') inCode = !inCode;
    else if (CLAUSE_MARKS.includes(c)) {
      // Only before a space, so "1,000" and "7:30" are not clauses.
      const spaced = /\s/.test(text[i + 1] ?? '');
      if (spaced && wordsBefore(i) >= MIN_CLAUSE_WORDS && nesting === 0 && !inCode) cut(i + 1);
    } else if (TERMINALS.includes(c)) {
      let end = i;
      while (end < text.length && TERMINALS.includes(text[end])) end += 1;
      while (end < text.length && CLOSERS.includes(text[end])) end += 1;
      if (endsSentence(text, text.slice(wordAt, i), i, end)) {
        cut(end);
        i = end - 1;
      }
    }
  }
  if (final) cut(text.length);
  return { units, next: start };
}
