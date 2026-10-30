/**
 * The Debug screen's reading of the Pond's live log (issue #165).
 *
 * Per-command timing needs no route of its own: each answered turn already logs a `turn_end`
 * line whose metadata carries how long it took. Warm-up turns the Pond runs for itself, with a
 * `prewarm-` session, are nobody's command and are left out.
 */

import type { TFunction } from 'i18next';

import { humanizeTool, toolWords } from '@/constants/tools';
import type { LogEntry } from '@/services/types';

/** Lines kept on screen; older ones are still in `GET /logs`. */
export const LOG_LINES_KEPT = 200;

/** Commands listed under timing. */
export const TIMINGS_KEPT = 10;

export interface CommandTiming {
  /** The log line's id, unique per Pond. */
  id: number;
  timestamp: string;
  totalMs: number;
  /** Time to the first token, when the turn reported it. */
  firstTokenMs: number | null;
  completionTokens: number | null;
}

function metadataOf(entry: LogEntry): Record<string, unknown> | null {
  if (!entry.metadata) return null;
  try {
    const parsed: unknown = JSON.parse(entry.metadata);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const numberOr = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The `kind` a `giap::trace` line was logged with, if any. */
export function traceKind(entry: LogEntry): string | null {
  const kind = metadataOf(entry)?.kind;
  return typeof kind === 'string' ? kind : null;
}

/** How long a command took, from its `turn_end` line; null for any other line. */
export function commandTiming(entry: LogEntry): CommandTiming | null {
  const meta = metadataOf(entry);
  if (meta?.kind !== 'turn_end') return null;
  if (typeof meta.session_id === 'string' && meta.session_id.startsWith('prewarm-')) return null;
  const totalMs = numberOr(meta.total_latency_ms);
  if (totalMs === null) return null;
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    totalMs,
    firstTokenMs: numberOr(meta.ttft_ms),
    completionTokens: numberOr(meta.completion_tokens),
  };
}

/**
 * Two newest-first lists as one, each id once, at most `cap`: the lines the Pond already holds
 * and the ones the stream delivered while they were being read.
 */
export function mergeNewestFirst<T extends { id: number }>(a: readonly T[], b: readonly T[], cap: number): T[] {
  const byId = new Map<number, T>();
  for (const item of [...a, ...b]) byId.set(item.id, item);
  return [...byId.values()].sort((x, y) => y.id - x.id).slice(0, cap);
}

/** `1.2 s`, or `850 ms` under a second. */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** `gguf/gemma-4-E4B…` → `gemma-4-E4B…`: the category is the catalogue's, not the model's name. */
export function modelLabel(modelId: string): string {
  const slash = modelId.indexOf('/');
  return slash === -1 ? modelId : modelId.slice(slash + 1);
}

// ── The log as sentences ─────────────────────────────────────────────────────
//
// The Pond logs for whoever reads its terminal: a `kind`, ids and counters. The Debug screen is
// read on a phone, so each kind it knows becomes a sentence, and the lines of one chat message,
// which share its session, are gathered under that message with its time. A kind added later
// reads as its own message, or failing that its name in words, never as JSON.

/** One row of the log: a chat message's lines together, or a line on its own. */
export type LogItem =
  | { type: 'command'; key: string; sessionId: string; lines: LogEntry[] }
  | { type: 'line'; key: string; entry: LogEntry; repeats: number };

const sessionOf = (entry: LogEntry): string | null => {
  const session = metadataOf(entry)?.session_id;
  return typeof session === 'string' && session ? session : null;
};

/** A warm-up the Pond runs on its own after a restart: nobody asked it anything. */
export const isWarmUp = (sessionId: string) => sessionId.startsWith('prewarm-');

/**
 * Newest-first lines as rows, newest first. Each `turn_start` opens a command; the session's later
 * lines join the command it last opened, its summary refresh after the reply included. A line
 * with no session that repeats the one before it, as the memory pass does every few seconds,
 * is counted rather than listed again.
 */
export function groupLog(lines: readonly LogEntry[]): LogItem[] {
  const items: LogItem[] = [];
  const lastCommand = new Map<string, Extract<LogItem, { type: 'command' }>>();
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = lines[i];
    const session = sessionOf(entry);
    if (session) {
      let command = lastCommand.get(session);
      if (!command || traceKind(entry) === 'turn_start') {
        command = { type: 'command', key: `command-${entry.id}`, sessionId: session, lines: [] };
        lastCommand.set(session, command);
        items.push(command);
      }
      command.lines.push(entry);
      continue;
    }
    const before = items[items.length - 1];
    const kind = traceKind(entry);
    if (
      before?.type === 'line' &&
      before.entry.level === entry.level &&
      before.entry.source === entry.source &&
      (kind !== null ? traceKind(before.entry) === kind : before.entry.message === entry.message)
    ) {
      items[items.length - 1] = { ...before, entry, repeats: before.repeats + 1 };
      continue;
    }
    items.push({ type: 'line', key: `line-${entry.id}`, entry, repeats: 1 });
  }
  return items.reverse();
}

/** `prompt_changed` → `Prompt changed`. */
function inWords(name: string): string {
  const words = name.replace(/[_:]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

function toolName(value: unknown, t: TFunction): string {
  const name = typeof value === 'string' ? value : '';
  const words = toolWords(name);
  return words ? t(words.label) : humanizeTool(name);
}

/** The `{"a", "b"}` a Rust set is logged as, as tool names. */
function toolNames(value: unknown, t: TFunction): string | null {
  if (typeof value !== 'string') return null;
  const names = [...value.matchAll(/"([^"]+)"/g)].map((m) => toolName(m[1], t));
  return names.length > 0 ? names.join(', ') : null;
}

const tokens = (n: number | null) => (n === null ? null : Math.round(n));

/** A log line as a sentence, with what is worth knowing about it underneath. */
export function describeLine(entry: LogEntry, t: TFunction): { text: string; detail: string | null } {
  const meta = metadataOf(entry) ?? {};
  const ms = (key: string) => {
    const n = numberOr(meta[key]);
    return n === null ? null : formatDuration(n);
  };
  const model = typeof meta.model === 'string' ? modelLabel(meta.model) : '';

  switch (meta.kind) {
    case 'turn_start':
      return {
        text: model ? t('debug.line.turnStart', { model }) : t('debug.line.turnStartNoModel'),
        detail: numberOr(meta.message_len) !== null ? t('debug.line.messageLength', { count: meta.message_len as number }) : null,
      };
    case 'tool_selection':
      return { text: t('debug.line.toolsOffered', { count: numberOr(meta.tools) ?? 0 }), detail: null };
    case 'tools_withheld_for_missing_secret':
      return { text: t('debug.line.toolsWithheld'), detail: toolNames(meta.tools, t) };
    case 'tool_call':
      return { text: t('debug.line.toolCall', { tool: toolName(meta.tool, t) }), detail: null };
    case 'tool_result':
      return {
        text:
          meta.failed === true
            ? t('debug.line.toolFailed', { tool: toolName(meta.tool, t) })
            : t('debug.line.toolResult', { tool: toolName(meta.tool, t) }),
        detail: ms('latency_ms'),
      };
    case 'inference': {
      const wrote = tokens(numberOr(meta.output_tokens));
      return {
        text: t('debug.line.inference', { count: wrote ?? 0 }),
        detail: ms('engine_ttft_ms') ? t('debug.line.inferenceStarted', { time: ms('engine_ttft_ms') }) : null,
      };
    }
    case 'turn_end': {
      const rate = numberOr(meta.decode_tok_per_sec);
      const parts = [
        ms('ttft_ms') ? t('debug.line.firstWord', { time: ms('ttft_ms') }) : null,
        tokens(numberOr(meta.completion_tokens)) !== null
          ? t('debug.line.tokens', { count: tokens(numberOr(meta.completion_tokens)) as number })
          : null,
        rate !== null ? t('debug.line.rate', { rate: rate.toFixed(1) }) : null,
      ].filter((p): p is string => p !== null);
      return {
        text: ms('total_latency_ms') ? t('debug.line.turnEnd', { time: ms('total_latency_ms') }) : t('debug.line.turnEndNoTime'),
        detail: parts.length > 0 ? parts.join(' · ') : null,
      };
    }
    case 'summary_refresh':
      return { text: t('debug.line.summaryRefresh'), detail: null };
    case 'session_retitled':
      return { text: t('debug.line.sessionRetitled'), detail: null };
    case 'model_activated':
      return {
        text: t('debug.line.modelActivated', {
          role: inWords(String(meta.role ?? '')),
          model: modelLabel(String(meta.model_id ?? '')),
        }),
        detail: null,
      };
    case 'provider_swap':
      return { text: t('debug.line.providerSwap', { model }), detail: null };
    case 'prefix_prewarm':
      return { text: t('debug.line.prewarm', { time: ms('elapsed_ms') ?? '' }), detail: model || null };
    case 'prefix_cache_served':
      return { text: t('debug.line.cacheServed'), detail: null };
    case 'prefix_cache_invalidated':
      return {
        text: t('debug.line.cacheRebuilt'),
        detail: typeof meta.reason === 'string' ? inWords(meta.reason) : null,
      };
    case 'memory_extraction_pass':
      return { text: t('debug.line.memoryPass'), detail: t('debug.line.memoriesSaved', { count: numberOr(meta.written) ?? 0 }) };
    case 'suggestions_composed':
      return { text: t('debug.line.suggestions', { count: numberOr(meta.queued) ?? 0 }), detail: null };
    case 'developer_debug':
      return { text: meta.enabled === true ? t('debug.line.debugOn') : t('debug.line.debugOff'), detail: null };
    case 'test_pond':
      return { text: t('debug.line.testPond'), detail: null };
    case 'matter_state_changed':
      return { text: t('debug.line.matterState', { state: String(meta.to ?? '') }), detail: null };
  }

  // Not a kind named above: the Pond's own words, or the kind's name, and where it came from.
  const text = entry.message ? inWords(entry.message) : typeof meta.kind === 'string' ? inWords(meta.kind) : entry.source;
  return { text, detail: entry.source === 'giap::trace' ? null : entry.source };
}

/** A command's heading: whose it was, when it started, and how long it took if it is done. */
export function describeCommand(
  item: Extract<LogItem, { type: 'command' }>,
): { warmUp: boolean; startedAt: string; totalMs: number | null; running: boolean } {
  const end = item.lines.find((l) => traceKind(l) === 'turn_end');
  return {
    warmUp: isWarmUp(item.sessionId),
    startedAt: item.lines[0].timestamp,
    totalMs: end ? numberOr(metadataOf(end)?.total_latency_ms) : null,
    // Only a command seen starting is known to be unfinished: older lines may have been dropped.
    running: !end && traceKind(item.lines[0]) === 'turn_start',
  };
}
