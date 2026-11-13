// What the Pond stored beside a message: where it came from, what it really set, and what it
// offers. Read from the saved note or a live `tool_result` frame only, never out of a reply's words.

import { list, record, text, textOrNull } from './me-read';

export const NOTE_FROM_KINDS = ['schedule', 'reminder', 'task', 'lookup', 'watch', 'heartbeat', 'suggestion'] as const;
export type NoteFromKind = (typeof NOTE_FROM_KINDS)[number];

export interface NoteFrom {
  /** Null for a kind this app does not know, which still shows its label. */
  kind: NoteFromKind | null;
  label: string;
  refId: string | null;
}

export interface Receipt {
  kind: string;
  outcome: 'set' | 'not_set';
  what: string;
  /** Why it was not set. */
  reason: string | null;
}

export type OfferState = 'open' | 'done' | 'dismissed';

/** Something Goose noticed and offers to do. */
export interface Offer {
  noticed: string;
  /** The button's words. */
  action: string;
  /** Sent as the person's own turn when the offer is taken. */
  prompt: string;
  state: OfferState;
}

export interface MessageNote {
  from?: NoteFrom;
  receipts?: Receipt[];
  offer?: Offer;
}

function readFrom(raw: unknown): NoteFrom | null {
  const r = record(raw);
  if (!r) return null;
  const kind = NOTE_FROM_KINDS.find((k) => k === r.kind) ?? null;
  const label = text(r.label);
  // A line with neither a known kind nor a label has nothing to say.
  if (!kind && !label) return null;
  return { kind, label, refId: textOrNull(r.ref_id) };
}

/** One receipt, or null when it does not say whether the thing was set, or what the thing was. */
export function readReceipt(raw: unknown): Receipt | null {
  const r = record(raw);
  const what = text(r?.what);
  if (!r || !what || (r.outcome !== 'set' && r.outcome !== 'not_set')) return null;
  return { kind: text(r.kind), outcome: r.outcome, what, reason: textOrNull(r.reason) };
}

function readOffer(raw: unknown): Offer | null {
  const r = record(raw);
  const noticed = text(r?.noticed);
  const prompt = text(r?.prompt);
  const state = r?.state === 'done' || r?.state === 'dismissed' ? r.state : r?.state === 'open' ? 'open' : null;
  // An open offer with nothing to send cannot be taken, so it is not offered.
  if (!r || !state || !noticed || (state === 'open' && !prompt)) return null;
  return { noticed, action: text(r.action), prompt, state };
}

/** The note on a saved message, or null when it holds nothing this app draws. */
export function readNote(raw: unknown): MessageNote | null {
  const r = record(raw);
  if (!r) return null;
  const from = readFrom(r.from);
  const receipts = list(r.receipts).flatMap((item) => readReceipt(item) ?? []);
  const offer = readOffer(r.suggestion);
  if (!from && receipts.length === 0 && !offer) return null;
  return { ...(from ? { from } : {}), ...(receipts.length ? { receipts } : {}), ...(offer ? { offer } : {}) };
}

/** A note with one more receipt, as a live turn collects them. */
export function withReceipt(note: MessageNote | undefined, receipt: Receipt): MessageNote {
  return { ...note, receipts: [...(note?.receipts ?? []), receipt] };
}

/** A note whose offer has been answered. */
export function withOfferState(note: MessageNote, state: OfferState): MessageNote {
  return note.offer ? { ...note, offer: { ...note.offer, state } } : note;
}
