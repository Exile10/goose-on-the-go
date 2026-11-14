// What Goose wrote down for itself about working for this member: lessons it learned and its
// open follow-ups (pond docs/architecture/my-goose-hub.md, part 0b). The member reads and
// deletes them; only Goose writes them.

import { list, record, text, time } from './me-read';

export interface GooseNote {
  id: string;
  text: string;
  createdAt: string | null;
  /** A household note rather than one about this member. */
  shared: boolean;
}

export interface GooseNotes {
  lessons: GooseNote[];
  notes: GooseNote[];
}

export const EMPTY_NOTES: GooseNotes = { lessons: [], notes: [] };

function readNote(raw: unknown): GooseNote | null {
  const r = record(raw);
  const id = text(r?.id);
  const words = text(r?.text);
  return r && id && words ? { id, text: words, createdAt: time(r.created_at), shared: r.shared === true } : null;
}

export function readGooseNotes(raw: unknown): GooseNotes {
  const r = record(raw);
  return {
    lessons: list(r?.lessons).flatMap((n) => readNote(n) ?? []),
    notes: list(r?.notes).flatMap((n) => readNote(n) ?? []),
  };
}
