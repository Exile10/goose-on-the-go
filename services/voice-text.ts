/**
 * Text processing for the voice pipeline — sentence splitting, markdown
 * stripping, symbol normalization, and Whisper-artifact filtering.
 *
 * Ported from goose-in-a-pond's desktop voice pipeline
 * (`pond-desktop/src/modes/voice/webAudioUtils.ts`), itself a TS port of the
 * server's `tts_text.rs`. Pure string functions — no RN/Expo APIs.
 */

// ── Sentence Splitter ─────────────────────────────────────────────

const ABBREV_RE = /(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|approx|dept|govt)\./i;
const MAX_SENTENCE_CHARS = 250;

/**
 * Split text into sentences for incremental TTS.
 *
 * Splits on sentence-ending punctuation (.!?) followed by whitespace-or-end,
 * but avoids splitting on common abbreviations. Force-flushes at 250 chars
 * to avoid unbounded accumulation on code blocks or lists.
 */
export function splitSentences(text: string): string[] {
  if (!text.trim()) return [];

  const sentences: string[] = [];
  let current = '';

  for (let i = 0; i < text.length; i++) {
    current += text[i];
    const ch = text[i];

    if (current.length >= MAX_SENTENCE_CHARS) {
      sentences.push(current.trim());
      current = '';
      continue;
    }

    if (ch === '.' || ch === '!' || ch === '?') {
      const nextIdx = i + 1;
      const isEnd = nextIdx >= text.length;
      const nextIsSpace = !isEnd && /\s/.test(text[nextIdx]);

      if (isEnd || nextIsSpace) {
        const trimmed = current.trim();
        if (!ABBREV_RE.test(trimmed)) {
          sentences.push(trimmed);
          current = '';
        }
      }
    }
  }

  const leftover = current.trim();
  if (leftover) sentences.push(leftover);
  return sentences;
}

// ── Markdown Stripping (for TTS) ─────────────────────────────────

/** Strip markdown syntax so TTS reads clean prose. */
export function stripMarkdown(text: string): string {
  let out = text;
  // Code fences
  out = out.replace(/```[\s\S]*?```/g, '');
  out = out.replace(/~~~[\s\S]*?~~~/g, '');
  // Horizontal rules
  out = out.replace(/^[-*_]{3,}\s*$/gm, '');
  // Line prefixes: headings, blockquotes, list markers
  out = out.replace(/^#{1,6}\s+/gm, '');
  out = out.replace(/^>\s*/gm, '');
  out = out.replace(/^[-*+]\s+/gm, '');
  out = out.replace(/^\d+\.\s+/gm, '');
  // Images
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Links
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Inline formatting: bold, italic, strikethrough, code
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');
  out = out.replace(/\*([^*]+)\*/g, '$1');
  out = out.replace(/_([^_]+)_/g, '$1');
  out = out.replace(/~~([^~]+)~~/g, '$1');
  out = out.replace(/`([^`]+)`/g, '$1');
  // Collapse whitespace
  out = out.replace(/\n{2,}/g, '. ');
  out = out.replace(/\s{2,}/g, ' ');
  return out.trim();
}

// ── Symbol Normalization (for TTS) ───────────────────────────────

const SYMBOL_RULES: [RegExp, string][] = [
  // Time
  [/(\d{1,2}):(\d{2})\s*(am|pm)/gi, '$1 $2 $3'],
  [/(\d{1,2})(am|pm)/gi, '$1 $2'],
  // Units
  [/(\d+(?:\.\d+)?)\s*kg/gi, '$1 kilograms'],
  [/(\d+(?:\.\d+)?)\s*MB\/s/gi, '$1 megabytes per second'],
  [/(\d+(?:\.\d+)?)\s*KB\/s/gi, '$1 kilobytes per second'],
  [/(\d+(?:\.\d+)?)\s*GB/gi, '$1 gigabytes'],
  [/(\d+(?:\.\d+)?)\s*MB/gi, '$1 megabytes'],
  [/(\d+(?:\.\d+)?)\s*KB/gi, '$1 kilobytes'],
  [/(\d+(?:\.\d+)?)\s*ms/gi, '$1 milliseconds'],
  [/(\d+(?:\.\d+)?)\s*hz/gi, '$1 hertz'],
  // Currency
  [/\$(\d+(?:\.\d+)?)/g, '$1 dollars'],
  [/€(\d+(?:\.\d+)?)/g, '$1 euros'],
  [/£(\d+(?:\.\d+)?)/g, '$1 pounds'],
  // Abbreviations
  [/\be\.g\./gi, 'for example'],
  [/\bi\.e\./gi, 'that is'],
  [/\bDr\./g, 'doctor'],
  [/\bMr\./g, 'mister'],
  [/\bMrs\./g, 'missus'],
  // Special characters
  [/°C/g, 'degrees Celsius'],
  [/°F/g, 'degrees Fahrenheit'],
  [/%/g, ' percent'],
  [/\+/g, ' plus '],
  [/&/g, ' and '],
  [/±/g, 'plus or minus'],
  [/√/g, 'square root of'],
  [/π/g, 'pi'],
  // Fractions
  [/¼/g, 'one quarter'],
  [/½/g, 'one half'],
  [/¾/g, 'three quarters'],
];

/** Normalize symbols, units, and abbreviations for natural TTS pronunciation. */
export function normalizeForSpeech(text: string): string {
  let out = text;
  for (const [re, replacement] of SYMBOL_RULES) {
    out = out.replace(re, replacement);
  }
  return out;
}

// ── Whisper Artifact Stripping ────────────────────────────────────

/** Regex patterns that Whisper inserts as artifacts in silent or noisy audio. */
const WHISPER_ARTIFACT_PATTERNS = [
  /^\s*\[.*?\]\s*$/, // [BLANK_AUDIO], [silence], etc.
  /^\s*\(.*?\)\s*$/, // (inaudible), (silence), etc.
  /^\s*♪.*$/, // Music notation
  /^\s*\.+\s*$/, // Just dots
];

/** Exact-match hallucinations, lowercase. */
const WHISPER_HALLUCINATIONS = new Set([
  'thank you',
  'thank you.',
  'thanks for watching',
  'thanks for watching.',
  'bye',
  'bye.',
  'okay',
  'okay.',
  'so',
  'um',
  'uh',
  'you',
  'the end',
  'the end.',
  'thanks',
]);

/**
 * True if the transcript text is a known Whisper artifact (hallucination on
 * silence/noise). Also rejects transcripts <= 2 chars and repeated single
 * words like "uh uh uh". Server-side `strip_whisper_artifacts` already does
 * this too, but the client filters defensively rather than trusting it.
 */
export function isWhisperArtifact(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length <= 2) return true;
  if (WHISPER_ARTIFACT_PATTERNS.some((re) => re.test(trimmed))) return true;
  if (WHISPER_HALLUCINATIONS.has(trimmed.toLowerCase())) return true;
  const words = trimmed.toLowerCase().split(/\s+/);
  if (words.length >= 2 && words.every((w) => w === words[0])) return true;
  return false;
}

// ── Dismissal Detection ──────────────────────────────────────────

const DISMISSAL_PHRASES = [
  'bye',
  'goodbye',
  'good bye',
  'see you',
  'see ya',
  'dismissed',
  'stop',
  'stop listening',
  'shut up',
  "that's all",
  'that is all',
  'go to sleep',
  'never mind',
  'nevermind',
];
const EXIT_PHRASES = ['exit', 'quit'];

/**
 * Whole-utterance match (never a substring — "stop the kitchen timer" is not
 * a dismissal) against the backend's own dismissal/exit phrase list
 * (`pond-voice/src/control.rs`), so the auto-listen loop can end a
 * conversation early instead of always waiting out the 8s silence timeout.
 */
export function checkDismissal(text: string): { dismissed: boolean; isExit: boolean } {
  const lower = text.toLowerCase().trim().replace(/[.!]+$/, '');
  if (EXIT_PHRASES.some((p) => lower === p)) return { dismissed: true, isExit: true };
  if (DISMISSAL_PHRASES.some((p) => lower === p)) return { dismissed: true, isExit: false };
  return { dismissed: false, isExit: false };
}

// ── Tool Announcements ───────────────────────────────────────────

const TOOL_ANNOUNCEMENTS: Record<string, string> = {
  weather: 'Let me check the weather.',
  save_memory: "Got it, I'll remember that.",
  recall_memories: 'Let me think back.',
  recall_memory: 'Let me think back.',
  forget_memory: "Noted, I'll forget that.",
  wikipedia: 'Let me look that up.',
  create_schedule: 'Setting that up for you.',
  list_schedules: 'Let me check your schedules.',
  delete_schedule: 'Removing that schedule.',
  run_schedule_now: 'Running that now.',
  devices: 'Checking your devices.',
};

/** Spoken announcement for a tool call, or a generic fallback. */
export function getToolAnnouncement(toolName: string): string {
  return TOOL_ANNOUNCEMENTS[toolName] ?? 'Working on that.';
}
