// Ideas Goose researched for the member: something new about what they care about, sourced, with a
// part Goose can take on and steps the member can take (docs/MY-GOOSE-HUB.md, part 6).

import { list, oneOf, pondPath, readAll, readSourceRefs, record, strings, text, time, type SourceRef } from './me-read';

export type IdeaState = 'new' | 'working' | 'done' | 'dismissed';
export type GooseCanKind = 'research' | 'watch' | 'todo' | 'schedule' | 'chat';

export interface Idea {
  id: string;
  title: string;
  pitch: string;
  why: string;
  groundedIn: { kind: 'interest' | 'memory' | 'conversation'; label: string }[];
  sources: SourceRef[];
  picture: string | null;
  gooseCan: { label: string; kind: GooseCanKind } | null;
  youCan: string[];
  state: IdeaState;
  taskId: string | null;
  createdAt: string | null;
}

export function readIdea(raw: unknown): Idea | null {
  const r = record(raw);
  const id = text(r?.id);
  const title = text(r?.title);
  if (!r || !id || !title) return null;
  const gooseCan = record(r.goose_can);
  const gooseLabel = text(gooseCan?.label);
  return {
    id,
    title,
    pitch: text(r.pitch),
    why: text(r.why),
    groundedIn: list(r.grounded_in).flatMap((g) => {
      const o = record(g);
      const label = text(o?.label);
      return label ? [{ kind: oneOf(o?.kind, ['interest', 'memory', 'conversation'] as const, 'conversation'), label }] : [];
    }),
    sources: readSourceRefs(r.sources),
    picture: pondPath(r.picture),
    gooseCan: gooseLabel ? { label: gooseLabel, kind: oneOf(gooseCan?.kind, ['research', 'watch', 'todo', 'schedule', 'chat'] as const, 'chat') } : null,
    youCan: strings(r.you_can),
    // An unknown state is "new": shown, and asking nothing it may not do.
    state: oneOf(r.state, ['new', 'working', 'done', 'dismissed'] as const, 'new'),
    taskId: text(record(r.progress)?.task_id) || null,
    createdAt: time(r.created_at),
  };
}

export function readIdeas(raw: unknown): { ideas: Idea[]; state: 'idle' | 'thinking' } {
  const r = record(raw);
  return { ideas: readAll(raw, 'ideas', readIdea), state: oneOf(r?.state, ['idle', 'thinking'] as const, 'idle') };
}

/** Ideas to show: dismissed ones never, the rest newest first with the ones in hand first. */
export function shownIdeas(ideas: readonly Idea[]): Idea[] {
  const rank: Record<IdeaState, number> = { working: 0, new: 1, done: 2, dismissed: 3 };
  return ideas
    .filter((i) => i.state !== 'dismissed')
    .sort((a, b) => rank[a.state] - rank[b.state] || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** The one idea My Goose features: the newest one nobody has acted on, else the one Goose is on. */
export function featuredIdea(ideas: readonly Idea[]): Idea | null {
  const shown = shownIdeas(ideas);
  return shown.find((i) => i.state === 'new') ?? shown.find((i) => i.state === 'working') ?? null;
}
