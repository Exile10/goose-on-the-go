/**
 * The cards a conversation was drawn with, kept on this phone.
 *
 * A tool can ask for its answer to be drawn as a card — the weather as a
 * forecast, the lights as a list — and that request reaches the phone once, on
 * the live stream. The Pond takes it off the answer before the model reads it
 * and saves only the words, so a conversation read back from history had
 * nothing to draw from: the forecast on screen a minute ago came back as the
 * text the model was given. So the phone keeps each card it is shown, by
 * conversation and by the call that produced it, and `fromHistory` puts it
 * back.
 *
 * It cannot conjure a card it never saw. A turn from before this, or one that
 * streamed to another device, still shows its result text.
 *
 * The cards are the household's — who is home, what Goose remembers — so they
 * go with their conversation when it is deleted, all at once when the phone
 * signs out, and oldest first once more conversations are kept than anyone
 * scrolls back to.
 */

import type { CardHint } from '@/models/chat';
import { storageFamily } from '@/services/storage';

/** A conversation's cards, by the id of the tool call each one answered. */
export type CardsByCall = Record<string, CardHint>;

/** Conversations kept. Past this, the ones least recently added to go first. */
export const MAX_CONVERSATIONS = 100;

/** A card bigger than this is not worth keeping; its result text stands in. */
export const MAX_CARD_CHARS = 32_000;

interface Kept {
  /** When a card was last added, which is what eviction orders by. */
  at: number;
  cards: CardsByCall;
}

const family = storageFamily('toolCards');

/**
 * Cards kept since launch. A read merges these over what storage holds, so a
 * conversation reopened while its card is still being written still has it.
 */
const recent = new Map<string, CardsByCall>();

/** One write at a time: two cards from one turn must not overwrite each other. */
let writes: Promise<void> = Promise.resolve();

function queueWrite(work: () => Promise<void>): Promise<void> {
  // A failed write loses a card, which the result text stands in for. It must
  // not also stop every write after it.
  writes = writes.then(work).catch(() => {});
  return writes;
}

async function evict(): Promise<void> {
  const ids = await family.ids();
  const excess = ids.length - MAX_CONVERSATIONS;
  if (excess <= 0) return;
  const kept = await family.getManyJSON<Kept>(ids);
  const oldest = ids
    .map((id) => ({ id, at: kept.get(id)?.at ?? 0 }))
    .sort((a, b) => a.at - b.at)
    .slice(0, excess)
    .map((entry) => entry.id);
  for (const id of oldest) recent.delete(id);
  await family.remove(oldest);
}

/** Keep a card the phone was shown, against its conversation and its call. */
export function rememberCard(sessionId: string, callId: string, card: CardHint): Promise<void> {
  if (JSON.stringify(card.data).length > MAX_CARD_CHARS) return Promise.resolve();
  recent.set(sessionId, { ...recent.get(sessionId), [callId]: card });
  return queueWrite(async () => {
    const kept = await family.getJSON<Kept>(sessionId);
    await family.setJSON<Kept>(sessionId, {
      at: Date.now(),
      cards: { ...kept?.cards, [callId]: card },
    });
    if (!kept) await evict();
  });
}

/** Every card kept for a conversation. Nothing kept, or storage failing, is `{}`. */
export async function cardsFor(sessionId: string): Promise<CardsByCall> {
  let stored: CardsByCall | undefined;
  try {
    stored = (await family.getJSON<Kept>(sessionId))?.cards;
  } catch {
    // Unreadable is the same as never kept: the result text stands in.
  }
  return { ...stored, ...recent.get(sessionId) };
}

/** Drop the cards of conversations that are gone. */
export function forgetCards(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return Promise.resolve();
  for (const id of sessionIds) recent.delete(id);
  return queueWrite(() => family.remove(sessionIds));
}

/** Drop every card: a phone that signs out keeps nothing of the household. */
export function forgetAllCards(): Promise<void> {
  recent.clear();
  return queueWrite(async () => family.remove(await family.ids()));
}
