/**
 * The models on a Pond as a household reads them: which job each can do, which one holds each job,
 * what is downloading, and what the files cost in space.
 */

import { MODEL_SECTIONS, type DownloadEntry, type HelperModel, type ModelEntry, type ModelRole, type ModelSection, type ModelUse } from '@/services/types';

/** The jobs in the order the Models page lists them. */
export const MODEL_ROLES: readonly ModelRole[] = ['chat', 'asr', 'tts', 'embedding'];

/** The job a model can hold, from its category: one per kind, as the Pond assigns them. */
export function roleOf(model: Pick<ModelEntry, 'category'>): ModelRole {
  switch (model.category) {
    case 'whisper':
      return 'asr';
    case 'tts':
      return 'tts';
    case 'embedding':
      return 'embedding';
    default:
      return 'chat';
  }
}

/** The category the Pond's routes name a model by. */
export function routeCategory(model: Pick<ModelEntry, 'category' | 'pond_category'>): string {
  return model.pond_category || model.category;
}

/** `{category}/{name}`, the id the Pond tracks a download under. */
export function pondModelId(model: Pick<ModelEntry, 'category' | 'pond_category' | 'name'>): string {
  return `${routeCategory(model)}/${model.name}`;
}

export function titleOf(model: Pick<ModelEntry, 'title' | 'name'>): string {
  return model.title?.trim() || model.name;
}

export function isDownloaded(model: Pick<ModelEntry, 'downloaded'>): boolean {
  return model.downloaded !== false;
}

const USES: readonly ModelUse[] = ['chat', 'tool', 'asr', 'tts', 'embedding', 'pictures', 'drafter', 'camera', 'faces'];

/** Jobs this phone has words for; one a newer Pond adds is left off rather than shown raw. */
export function knownUses(uses: readonly string[] | undefined): ModelUse[] {
  return (uses ?? []).filter((u): u is ModelUse => (USES as readonly string[]).includes(u));
}

/**
 * The jobs a row is doing. The Pond says so on each row, read from its settings; an older Pond
 * does not, and there a row the Pond assigned does the one job its category can hold.
 */
export function usesOf(model: Pick<ModelEntry, 'roles' | 'active' | 'category'>): ModelUse[] {
  if (Array.isArray(model.roles)) return knownUses(model.roles);
  return model.active ? [roleOf(model)] : [];
}

/** `model` with `role` given to it or taken from it, as a change is shown before the Pond answers. */
export function withRole(model: ModelEntry, role: ModelRole, holds: boolean): ModelEntry {
  const roles = model.roles?.filter((r) => r !== role);
  return { ...model, active: holds, roles: roles && holds ? [...roles, role] : roles };
}

const SECTION_OF_ROLE: Record<ModelRole, ModelSection> = {
  chat: 'conversation',
  asr: 'listening',
  tts: 'speaking',
  embedding: 'memory',
};

/** The section a row is listed under: the Pond's word, else (an older Pond) its category's job. */
export function sectionOf(model: Pick<ModelEntry, 'section' | 'category'>): ModelSection {
  if (model.section && (MODEL_SECTIONS as readonly string[]).includes(model.section)) return model.section;
  return SECTION_OF_ROLE[roleOf(model)];
}

export type SectionEntry = { kind: 'model'; model: ModelEntry } | { kind: 'helper'; helper: HelperModel };

export interface ModelSectionGroup {
  section: ModelSection;
  entries: SectionEntry[];
}

/**
 * What is on the Pond, by section in `MODEL_SECTIONS` order: every downloaded row, every row doing
 * a job even when the Pond fetched its weights itself (a built-in memory model has no file), and
 * the models in use beside the rows. Within a section the rows doing a job come first. Sections
 * with nothing in them are left out.
 */
export function sectionsOnPond(models: ModelEntry[], helpers: HelperModel[]): ModelSectionGroup[] {
  const shown = models.filter((m) => isDownloaded(m) || usesOf(m).length > 0);
  const working = (m: ModelEntry) => (usesOf(m).length > 0 ? 0 : 1);
  return MODEL_SECTIONS.map((section) => ({
    section,
    entries: [
      ...shown
        .filter((m) => sectionOf(m) === section)
        .sort((a, b) => working(a) - working(b))
        .map((model): SectionEntry => ({ kind: 'model', model })),
      ...helpers
        .filter((h) => (MODEL_SECTIONS.includes(h.section) ? h.section : 'other') === section)
        .map((helper): SectionEntry => ({ kind: 'helper', helper })),
    ],
  })).filter((g) => g.entries.length > 0);
}

/** The model holding a job, or null when nothing does. */
export function holderOf(models: ModelEntry[], role: ModelRole): ModelEntry | null {
  return models.find((m) => usesOf(m).includes(role)) ?? null;
}

/** Downloaded models that can hold a job and that this Pond can run. */
export function candidatesFor(models: ModelEntry[], role: ModelRole): ModelEntry[] {
  return models.filter((m) => roleOf(m) === role && isDownloaded(m) && m.available !== false);
}

/**
 * The model a job can go back to: the one it had before its last change, while that model is
 * still on the Pond, can run, and is not the one doing the job now.
 */
export function rollbackTarget(models: ModelEntry[], role: ModelRole, lastWorkingId: string | undefined): ModelEntry | null {
  if (!lastWorkingId) return null;
  return candidatesFor(models, role).find((m) => m.id === lastWorkingId && !usesOf(m).includes(role)) ?? null;
}

/** The picture add-on a model offers, when it offers one. */
export function picturesOf(model: Pick<ModelEntry, 'companions'>) {
  return model.companions?.find((c) => c.kind === 'pictures') ?? null;
}

/** A download is going while any of its parts is moving or waiting. */
export function isLive(entry: DownloadEntry): boolean {
  return entry.status === 'downloading' || entry.status === 'paused';
}

export interface ModelDownload {
  modelId: string;
  /** What the parts add up to, so a model with an add-on reads as one download. */
  downloaded: number;
  total: number | null;
  status: DownloadEntry['status'];
  error: string | null;
  resumable: boolean;
  /** The file name, for a download the catalogue has no row for. */
  filename: string;
}

/**
 * The Pond's per-file progress folded into one line per model. A part that failed makes the whole
 * download failed; a part still moving keeps it downloading.
 */
export function downloadsByModel(entries: DownloadEntry[]): ModelDownload[] {
  const byModel = new Map<string, DownloadEntry[]>();
  for (const entry of entries) {
    const key = entry.model_id || entry.filename;
    byModel.set(key, [...(byModel.get(key) ?? []), entry]);
  }
  return [...byModel.entries()].map(([modelId, parts]) => {
    const totals = parts.map((p) => p.total_bytes);
    const status: DownloadEntry['status'] = parts.some((p) => p.status === 'error')
      ? 'error'
      : parts.some((p) => p.status === 'downloading')
        ? 'downloading'
        : parts.some((p) => p.status === 'paused')
          ? 'paused'
          : parts.every((p) => p.status === 'cancelled')
            ? 'cancelled'
            : 'done';
    return {
      modelId,
      downloaded: parts.reduce((sum, p) => sum + p.downloaded_bytes, 0),
      total: totals.every((t) => typeof t === 'number') ? totals.reduce((sum: number, t) => sum + (t ?? 0), 0) : null,
      status,
      error: parts.find((p) => p.error)?.error ?? null,
      resumable: parts.some((p) => p.resumable),
      filename: parts.find((p) => p.part !== 'pictures')?.filename ?? parts[0].filename,
    };
  });
}

/** How far along, from 0 to 1, or null when the Pond does not know the size yet. */
export function fractionDone(d: Pick<ModelDownload, 'downloaded' | 'total'>): number | null {
  if (!d.total) return null;
  return Math.min(1, Math.max(0, d.downloaded / d.total));
}

/** Bytes as a household reads them: `1.2 GB`, `86 MB`. */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return null;
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** Megabytes, as the catalogue records sizes. */
export function formatMegabytes(mb: number | null | undefined): string | null {
  return mb ? formatBytes(mb * 1024 ** 2) : null;
}

/** Whether a model needs more memory than one model may use on this Pond. */
export function tooBig(model: Pick<ModelEntry, 'ram_estimate_mb'>, budgetMb: number | undefined): boolean {
  return !!budgetMb && !!model.ram_estimate_mb && model.ram_estimate_mb > budgetMb;
}

/** The Pond's suggestions, best first, that are not already holding a job. */
export function recommendations(models: ModelEntry[]): ModelEntry[] {
  const rank = (m: ModelEntry) => (m.recommended?.rank === 'primary' ? 0 : 1);
  return models.filter((m) => m.recommended && !m.active).sort((a, b) => rank(a) - rank(b));
}

export type SetupModelChoice =
  /** A chat model is on the Pond and doing the job: setup can finish. */
  | { kind: 'held'; model: ModelEntry }
  /** One is on the Pond but nothing holds the job: it only needs giving the job. */
  | { kind: 'ready'; model: ModelEntry }
  | { kind: 'downloading'; model: ModelEntry; download: ModelDownload }
  /** The Pond's best suggestion, to ask about before fetching. */
  | { kind: 'download'; model: ModelEntry }
  | { kind: 'none' };

/** What owner setup's model step offers, for a Pond that refused to finish without a chat model. */
export function setupModelChoice(models: ModelEntry[], downloads: DownloadEntry[]): SetupModelChoice {
  const held = holderOf(models, 'chat');
  if (held && isDownloaded(held)) return { kind: 'held', model: held };
  const live = downloadsByModel(downloads).filter((d) => d.status === 'downloading' || d.status === 'paused');
  const chats = models.filter((m) => roleOf(m) === 'chat');
  for (const model of chats) {
    const download = live.find((d) => d.modelId === pondModelId(model));
    if (download) return { kind: 'downloading', model, download };
  }
  // Named for the job but not on disk yet: fetching it keeps the choice already made.
  if (held) return { kind: 'download', model: held };
  const onPond = candidatesFor(models, 'chat')[0];
  if (onPond) return { kind: 'ready', model: onPond };
  const suggested = recommendations(models).find((m) => roleOf(m) === 'chat' && m.available !== false);
  return suggested ? { kind: 'download', model: suggested } : { kind: 'none' };
}
