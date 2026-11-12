// Ideas Goose researched for the member: something new about what they care about, sourced, with a
// part Goose can take on and steps the member can take (docs/MY-GOOSE-HUB.md, part 6).

import { list, oneOf, pondPath, readAll, readSourceRefs, record, strings, text, time, type SourceRef } from './me-read';

export type IdeaState = 'new' | 'working' | 'done' | 'dismissed';
export type GooseCanKind = 'research' | 'watch' | 'todo' | 'schedule' | 'chat';
export const IDEA_KINDS = ['outing', 'activity', 'date', 'solo_date', 'trip', 'recipe', 'interest', 'project'] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];

/** One thing worth seeing at a glance on an idea's page: where, when, the cost. */
export interface IdeaFact {
  label: string;
  value: string;
}

export interface Idea {
  id: string;
  /** What sort of thing it is; an older Pond's ideas read as `interest`. */
  kind: IdeaKind;
  /** The Pond's own label for the kind, such as "Recipe"; empty from an older Pond. */
  kindLabel: string;
  title: string;
  /** The card's one line; an older Pond's ideas show their pitch. */
  hook: string;
  pitch: string;
  why: string;
  facts: IdeaFact[];
  /** What Goose kept to work from when the member asks about the idea. */
  notes: string;
  groundedIn: { kind: 'interest' | 'memory' | 'conversation' | 'screenshot'; label: string }[];
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
  const pitch = text(r.pitch);
  return {
    id,
    kind: oneOf(r.kind, IDEA_KINDS, 'interest'),
    kindLabel: text(r.kind_label),
    title,
    hook: text(r.hook) || pitch,
    pitch,
    why: text(r.why),
    facts: list(r.facts).flatMap((f) => {
      const o = record(f);
      const label = text(o?.label);
      const value = text(o?.value);
      return label && value ? [{ label, value }] : [];
    }),
    notes: text(r.notes),
    groundedIn: list(r.grounded_in).flatMap((g) => {
      const o = record(g);
      const label = text(o?.label);
      return label ? [{ kind: oneOf(o?.kind, ['interest', 'memory', 'conversation', 'screenshot'] as const, 'conversation'), label }] : [];
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
