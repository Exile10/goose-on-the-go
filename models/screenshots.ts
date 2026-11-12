// Ideas from the member's screenshots, off until they turn it on. The Pond looks at a screenshot
// once, keeps one line about what it shows, and never keeps the picture
// (pond docs/architecture/my-goose-hub.md, part 6b).

import { count, list, record, text, time } from './me-read';

export interface ScreenshotNote {
  id: string;
  note: string;
  takenAt: string | null;
  createdAt: string | null;
  /** When an idea was built on it. */
  usedAt: string | null;
}

export interface Screenshots {
  enabled: boolean;
  /** Whether this Pond's model can read pictures at all. */
  available: boolean;
  /** Screenshots sent and not yet read. */
  pending: number;
  maxPending: number;
  notes: ScreenshotNote[];
}

export const EMPTY_SCREENSHOTS: Screenshots = { enabled: false, available: false, pending: 0, maxPending: 6, notes: [] };

/** The longest side a screenshot is sent at: enough to read, small enough to send. */
export const SHOT_MAX_SIDE = 1280;
/** The largest picture the Pond takes, as base64 characters. */
export const SHOT_MAX_CHARS = 2_000_000;

export function readScreenshots(raw: unknown): Screenshots {
  const r = record(raw);
  return {
    enabled: r?.enabled === true,
    available: r?.available === true,
    pending: count(r?.pending),
    maxPending: count(r?.max_pending) || EMPTY_SCREENSHOTS.maxPending,
    notes: list(r?.notes).flatMap((n) => {
      const o = record(n);
      const id = text(o?.id);
      const note = text(o?.note);
      return o && id && note ? [{ id, note, takenAt: time(o.taken_at), createdAt: time(o.created_at), usedAt: time(o.used_at) }] : [];
    }),
  };
}

/** How many more screenshots can be sent before the Pond asks to wait. */
export function roomToSend(shots: Screenshots): number {
  return Math.max(0, shots.maxPending - shots.pending);
}
