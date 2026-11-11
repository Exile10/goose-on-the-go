// A long task the assistant started from the chat with `task_start`, which runs later, outside the
// turn. The chat finds it by the id in that tool's answer and follows it from there.

import { readList, readReportImage, readReportOption } from '@/models/web-watches';
import { bareToolName } from '@/constants/tools';
import type { ToolCall } from '@/models/chat';
import type {
  AnswerShape,
  DeepResearchAvailability,
  LongTask,
  LongTaskAhead,
  LongTaskArtifact,
  LongTaskQueuePlace,
  LongTaskReportWire,
  ReportFormat,
  LongTaskState,
  LongTaskStep,
  LongTaskStepState,
} from '@/services/types';

const TASK_STATES: readonly LongTaskState[] = ['planning', 'running', 'awaiting_approval', 'paused', 'completed', 'failed', 'cancelled'];
const STEP_STATES: readonly LongTaskStepState[] = ['pending', 'running', 'completed', 'failed', 'skipped', 'awaiting_approval'];
const ANSWER_SHAPES: readonly AnswerShape[] = ['auto', 'short', 'report'];

/** While it is planning or running: the poll floor, so a step that finishes is seen finishing. */
export const LONG_TASK_ACTIVE_MS = 5_000;
/** Waiting for a decision or paused: it moves when a person or the Pond's quiet hours move it. */
export const LONG_TASK_WAITING_MS = 30_000;

/** The id in `task_start`'s answer: "Started task <id>. The pond works on it...". */
export function taskIdFromResult(result: string | undefined): string | null {
  const found = /\bStarted task ([A-Za-z0-9][A-Za-z0-9_-]{7,127})\b/.exec(result ?? '');
  return found ? found[1] : null;
}

/** The long task a tool call started, or null for any other call, or one that did not start one. */
export function startedTaskId(tool: ToolCall): string | null {
  if (bareToolName(tool.name) !== 'task_start' || tool.status !== 'ok') return null;
  return taskIdFromResult(tool.result);
}

export function isEnded(state: LongTaskState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

/** How long until the task is read again, or null once it has ended and cannot change. */
export function pollDelay(state: LongTaskState): number | null {
  if (isEnded(state)) return null;
  return state === 'planning' || state === 'running' ? LONG_TASK_ACTIVE_MS : LONG_TASK_WAITING_MS;
}

/** An open task with another ahead of it in the one line the Pond works through. An older Pond does not say, so nothing waits. */
export function isWaiting(task: Pick<LongTask, 'state' | 'queue'>): boolean {
  return !isEnded(task.state) && (task.queue?.position ?? 1) > 1;
}

export function isOwnAhead(ahead: LongTaskAhead): ahead is Extract<LongTaskAhead, { id: string }> {
  return 'id' in ahead;
}

/** A task the member may keep going or stop, at its place in the line. */
export interface QueueChoice {
  id: string;
  goal: string;
  position: number;
  isThis: boolean;
}

/**
 * The member's own tasks ahead of this one, then this one. None when only other members' tasks are
 * ahead, since there is then nothing of theirs to choose between.
 */
export function queueChoices(task: Pick<LongTask, 'id' | 'goal' | 'state' | 'queue'>): QueueChoice[] {
  const queue = task.queue;
  if (!queue || !isWaiting(task)) return [];
  const ahead = queue.ahead.flatMap((entry, index) =>
    isOwnAhead(entry) ? [{ id: entry.id, goal: entry.goal, position: index + 1, isThis: false }] : [],
  );
  return ahead.length > 0 ? [...ahead, { id: task.id, goal: task.goal, position: queue.position, isThis: true }] : [];
}

export function resultArtifact(task: LongTask): LongTaskArtifact | null {
  if (!task.result_artifact_id) return null;
  return task.artifacts.find((a) => a.id === task.result_artifact_id) ?? null;
}

/** A finished short answer, read whole in the conversation; null leaves the card to name the report. */
export function shortAnswer(task: Pick<LongTask, 'state' | 'answer' | 'answer_text'>): string | null {
  if (task.state !== 'completed' || task.answer !== 'short') return null;
  return task.answer_text?.trim() ? task.answer_text : null;
}

export function progressOf(steps: readonly LongTaskStep[]): { done: number; total: number; skipped: number } {
  return {
    done: steps.filter((s) => s.state === 'completed').length,
    total: steps.length,
    skipped: steps.filter((s) => s.state === 'skipped').length,
  };
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const textOrNull = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
const isPlace = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;

/** Anything not plainly a task this member reaches is a place only, so a malformed entry never names one. */
function readAhead(item: unknown): LongTaskAhead {
  const a = item as Record<string, unknown> | null;
  if (a && typeof a === 'object' && a.another_member !== true && typeof a.id === 'string' && TASK_STATES.includes(a.state as LongTaskState)) {
    return { id: a.id, goal: text(a.goal), state: a.state as LongTaskState };
  }
  return { another_member: true };
}

/** Absent stays absent (an older Pond); a place that cannot be read is no place, so nothing waits. */
function readQueue(raw: unknown): LongTaskQueuePlace | null | undefined {
  if (raw === undefined) return undefined;
  const q = raw as Record<string, unknown> | null;
  if (!q || typeof q !== 'object' || !isPlace(q.position) || !isPlace(q.of)) return null;
  return { position: q.position, of: q.of, ahead: (Array.isArray(q.ahead) ? q.ahead : []).map(readAhead) };
}

/**
 * A task as the Pond sent it, or null for a body that is not one. A state this phone does not know
 * is not one it can say anything true about, so that is null too.
 */
export function readLongTask(raw: unknown): LongTask | null {
  const t = raw as Record<string, unknown> | null;
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !TASK_STATES.includes(t.state as LongTaskState)) return null;
  const steps: LongTaskStep[] = (Array.isArray(t.steps) ? t.steps : []).flatMap((item) => {
    const s = item as Record<string, unknown> | null;
    if (!s || typeof s.key !== 'string') return [];
    return [
      {
        key: s.key,
        role: text(s.role),
        state: STEP_STATES.includes(s.state as LongTaskStepState) ? (s.state as LongTaskStepState) : 'pending',
        attempts: typeof s.attempts === 'number' ? s.attempts : 0,
        summary: textOrNull(s.summary),
        failure: textOrNull(s.failure),
      },
    ];
  });
  const artifacts: LongTaskArtifact[] = (Array.isArray(t.artifacts) ? t.artifacts : []).flatMap((item) => {
    const a = item as Record<string, unknown> | null;
    if (!a || typeof a.id !== 'string') return [];
    return [
      {
        id: a.id,
        task_id: text(a.task_id),
        step_key: textOrNull(a.step_key),
        kind: text(a.kind),
        title: text(a.title),
        summary: text(a.summary),
        tokens: typeof a.tokens === 'number' ? a.tokens : 0,
        created_at: text(a.created_at),
      },
    ];
  });
  return {
    id: t.id,
    kind: t.kind === 'research' ? 'research' : 'general',
    goal: text(t.goal),
    state: t.state as LongTaskState,
    origin_session_id: textOrNull(t.origin_session_id),
    created_at: text(t.created_at),
    updated_at: text(t.updated_at),
    finished_at: textOrNull(t.finished_at),
    steps,
    artifacts,
    result_artifact_id: textOrNull(t.result_artifact_id),
    // Absent stays absent: an older Pond's task, or a shape this phone does not know, shows as a report.
    ...(ANSWER_SHAPES.includes(t.answer as AnswerShape) ? { answer: t.answer as AnswerShape } : {}),
    answer_text: textOrNull(t.answer_text),
    queue: readQueue(t.queue),
  };
}

/** Null for a body that is not the answer, which the composer reads as "do not offer it". */
export function readResearchAvailability(raw: unknown): DeepResearchAvailability | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || typeof r.available !== 'boolean') return null;
  if (r.available) return { available: true };
  return r.reason === 'off' || r.reason === 'unidentified' ? { available: false, reason: r.reason } : null;
}

/** What the composer's menu offers: nothing, the item, or the item greyed with why. */
export type ResearchOffer = 'hidden' | 'available' | 'unidentified';

/** `null` is a Pond that predates research, or an answer that could not be read: either way, hidden. */
export function researchOffer(availability: DeepResearchAvailability | null): ResearchOffer {
  if (!availability) return 'hidden';
  if (availability.available) return 'available';
  return availability.reason === 'unidentified' ? 'unidentified' : 'hidden';
}

/** Null for a body that is not a report; a missing count reads as none. */
export function readLongTaskReport(raw: unknown): LongTaskReportWire | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.markdown !== 'string') return null;
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const sources = (Array.isArray(r.sources) ? r.sources : []).flatMap((item) => {
    const s = item as Record<string, unknown> | null;
    return s && typeof s.url === 'string' ? [{ title: typeof s.title === 'string' ? s.title : s.url, url: s.url }] : [];
  });
  return {
    id: r.id,
    title: text(r.title),
    state: TASK_STATES.includes(r.state as LongTaskState) ? (r.state as LongTaskState) : 'completed',
    kind: r.kind === 'research' ? 'research' : 'general',
    markdown: r.markdown,
    sections: count(r.sections),
    sources,
    calendar_events: count(r.calendar_events),
    images: readList(r.images, readReportImage),
    options: readList(r.options, readReportOption),
  };
}

/** Each export's type and extension, as the Pond serves them; the share sheet is told the same. */
export const REPORT_FILES: Readonly<Record<ReportFormat, { mimeType: string; extension: string; uti: string }>> = {
  markdown: { mimeType: 'text/markdown', extension: 'md', uti: 'net.daringfireball.markdown' },
  html: { mimeType: 'text/html', extension: 'html', uti: 'public.html' },
  ics: { mimeType: 'text/calendar', extension: 'ics', uti: 'public.calendar-event' },
};

/**
 * The file name to share under: the Pond's `Content-Disposition` name when it is a plain one with
 * this format's extension, else `report.<ext>`. Nothing from the header reaches a path unchecked.
 */
export function reportFileName(disposition: string | null, format: ReportFormat): string {
  const { extension } = REPORT_FILES[format];
  const named = /filename="?([^";]+)"?/i.exec(disposition ?? '')?.[1]?.trim() ?? '';
  const stem = named.endsWith(`.${extension}`) ? named.slice(0, -(extension.length + 1)) : '';
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(stem) ? `${stem}.${extension}` : `report.${extension}`;
}

/** The PDF printed from an export's web page takes that page's name. */
export function pdfFileName(htmlName: string): string {
  return htmlName.replace(/\.html$/, '') + '.pdf';
}

export interface ReportSection {
  /** Empty for what comes before the first section: the report's title and summary. */
  title: string;
  markdown: string;
}

/**
 * The report cut at its section headings (`#` after the title, and `##`), so the reading screen can
 * jump between them. A heading inside a code fence is not one.
 */
export function reportSections(markdown: string): ReportSection[] {
  const out: ReportSection[] = [{ title: '', markdown: '' }];
  let fenced = false;
  let seenTitle = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,2})\s+(.+?)\s*#*\s*$/.exec(line);
    const isTitle = heading?.[1] === '#' && !seenTitle;
    if (heading && !isTitle) {
      out.push({ title: heading[2].replace(/[*_`]/g, ''), markdown: `${line}\n` });
      continue;
    }
    if (heading) seenTitle = true;
    out[out.length - 1].markdown += `${line}\n`;
  }
  return out.filter((s) => s.title !== '' || s.markdown.trim() !== '');
}
