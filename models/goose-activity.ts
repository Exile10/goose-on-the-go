// What Goose did for this member without being asked: a reminder it set, a note it wrote
// itself, a failing watch it paused, something it looked up, a phone it removed because it had
// stopped connecting. The member reads the list and takes back what can be taken back; only
// Goose writes it.

import type { IconName } from '@/constants/icons';
import { count, list, oneOf, record, text, textOrNull, time } from './me-read';

export const ACTIVITY_KINDS = ['reminder', 'note', 'note_closed', 'watch_paused', 'suggestion', 'errand', 'phone_removed'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Kinds no answer from the Pond makes undoable: a removed phone comes back only by pairing it again. */
const NEVER_UNDONE: readonly ActivityKind[] = ['phone_removed'];

export interface GooseActivity {
  id: string;
  kind: ActivityKind;
  /** One line, as the Pond wrote it for the member. */
  summary: string;
  /** What an errand found. */
  detail: string | null;
  at: string | null;
  canUndo: boolean;
  undone: boolean;
}

export interface GooseActivityList {
  items: GooseActivity[];
  /** Entries newer than the member's last look. */
  unseen: number;
}

export const EMPTY_ACTIVITY: GooseActivityList = { items: [], unseen: 0 };

function readEntry(raw: unknown): GooseActivity | null {
  const r = record(raw);
  const id = text(r?.id);
  const summary = text(r?.summary);
  if (!r || !id || !summary) return null;
  // A kind this app does not know still shows its line; it reads as a note, which offers nothing.
  const kind = oneOf(r.kind, ACTIVITY_KINDS, 'note_closed');
  return {
    id,
    kind,
    summary,
    detail: textOrNull(r.detail),
    at: time(r.at),
    canUndo: r.can_undo === true && !NEVER_UNDONE.includes(kind),
    undone: r.undone === true,
  };
}

export function readGooseActivity(raw: unknown): GooseActivityList {
  const r = record(raw);
  return {
    items: list(r?.activity).flatMap((entry) => readEntry(entry) ?? []),
    unseen: count(r?.unseen),
  };
}

export function activityIcon(kind: ActivityKind): IconName {
  switch (kind) {
    case 'reminder':
      return 'bell';
    case 'note':
    case 'note_closed':
      return 'file-text';
    case 'watch_paused':
      return 'pause';
    case 'suggestion':
      return 'chat';
    case 'errand':
      return 'search';
    case 'phone_removed':
      return 'device';
  }
}
