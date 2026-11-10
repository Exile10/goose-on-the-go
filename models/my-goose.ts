// What My Goose gathers, reduced to what its screens say. Pure, so the sentence and the cart's
// arithmetic are tested without a Pond.

import type { PluralKey, TranslationKey } from '@/services/i18n';
import { headOf, inSentence } from './me-read';
import type { Schedule, ScheduleRun } from '@/services/types';
import type { SavedItem, WebWatch } from './web-watches';

/** A price the Pond wrote as words ("KSh 1,190,000"), as a number and the currency it named. */
export interface Price {
  amount: number;
  currency: string;
}

const NUMBER = /\d[\d,]*(?:\.\d+)?/;

export function readPrice(item: Pick<SavedItem, 'price' | 'currency'>): Price | null {
  const words = item.price?.trim();
  if (!words) return null;
  const found = NUMBER.exec(words);
  if (!found) return null;
  const amount = Number(found[0].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  const currency = item.currency?.trim() || words.replace(found[0], '').trim();
  return { amount, currency };
}

/** The amount as the household writes it, with the currency the Pond named. */
export function formatPrice(price: Price, locale?: string): string {
  const amount = price.amount.toLocaleString(locale, { maximumFractionDigits: 2 });
  return price.currency ? `${price.currency} ${amount}` : amount;
}

export interface CartLine {
  item: SavedItem;
  price: Price | null;
  /** The lowest price in its cart, when there are two or more to compare. */
  cheapest: boolean;
}

/** One collection of kept listings: alternatives to compare, so a range rather than a sum. */
export interface Cart {
  /** The collection's name, or null for listings kept outside any. */
  name: string | null;
  lines: CartLine[];
  low: Price | null;
  high: Price | null;
  updatedAt: string;
}

export function cartsFrom(items: SavedItem[]): Cart[] {
  const groups = new Map<string | null, SavedItem[]>();
  for (const item of items) {
    if (item.kind !== 'listing') continue;
    const key = item.collection?.trim() || null;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const carts: Cart[] = [];
  for (const [name, kept] of groups) {
    const priced = kept.map((item) => ({ item, price: readPrice(item) }));
    // Prices in different currencies cannot be compared, so the range is over the commonest one.
    const counts = new Map<string, number>();
    for (const p of priced) if (p.price) counts.set(p.price.currency, (counts.get(p.price.currency) ?? 0) + 1);
    const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const comparable = priced.filter((p) => p.price && p.price.currency === currency).map((p) => p.price as Price);
    const low = comparable.length ? comparable.reduce((a, b) => (b.amount < a.amount ? b : a)) : null;
    const high = comparable.length ? comparable.reduce((a, b) => (b.amount > a.amount ? b : a)) : null;
    const lines = priced
      .map((p) => ({
        ...p,
        cheapest: comparable.length > 1 && !!p.price && p.price.currency === currency && p.price.amount === low?.amount,
      }))
      .sort((a, b) => (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity));
    const updatedAt = kept.map((i) => i.updatedAt).sort().at(-1) ?? '';
    carts.push({ name, lines, low, high: high && low && high.amount !== low.amount ? high : null, updatedAt });
  }
  return carts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** What a scheduled question last answered: the Pond's own briefing, written while nobody asked. */
export interface Brief {
  scheduleId: string;
  name: string;
  prompt: string;
  text: string;
  at: string;
  earlier: { id: string; text: string; at: string }[];
}

export function briefFrom(schedule: Schedule, runs: ScheduleRun[]): Brief | null {
  if (schedule.kind.type !== 'agent_prompt') return null;
  const answered = runs
    .filter((r) => r.status === 'completed' && r.result?.trim())
    .sort((a, b) => (b.finished_at ?? b.started_at).localeCompare(a.finished_at ?? a.started_at));
  const [latest, ...rest] = answered;
  if (!latest) return null;
  return {
    scheduleId: schedule.id,
    name: schedule.label.trim(),
    prompt: schedule.kind.prompt,
    text: (latest.result as string).trim(),
    at: latest.finished_at ?? latest.started_at,
    earlier: rest.map((r) => ({ id: r.id, text: (r.result as string).trim(), at: r.finished_at ?? r.started_at })),
  };
}

/** Watches with listings matching now, most first: the ones with something to look at. */
export function watchesWithHits(watches: WebWatch[]): WebWatch[] {
  return watches.filter((w) => !w.paused && w.matchingCount > 0).sort((a, b) => b.matchingCount - a.matchingCount);
}

export type GooseShelf = 'offers' | 'watching' | 'news' | 'reminders' | 'cart' | 'ideas';

/** One clause of the sentence My Goose opens with, and the shelf it opens. */
export interface GooseClause {
  shelf: GooseShelf;
  key: TranslationKey | PluralKey;
  params: Record<string, string | number>;
}

export interface GooseFacts {
  offers: number;
  watchHits: WebWatch[];
  brief: Pick<Brief, 'name' | 'at'> | null;
  reminders: number;
  cart: { count: number; low: string | null } | null;
  ideas: number;
}

/** The sentence holds three clauses: past that it stops being read, and the shelves say the rest. */
export const SENTENCE_CLAUSES = 3;

/** A watch's name inside a sentence, cut where a long one would take the sentence over. */
function shortTitle(title: string): string {
  return title.length > 34 ? `${title.slice(0, 33).trimEnd()}…` : title;
}

/** What needs the reader first: a decision, then what changed, then what is ready, then what is kept. */
export function gooseClauses(facts: GooseFacts): GooseClause[] {
  const clauses: GooseClause[] = [];
  if (facts.offers > 0) clauses.push({ shelf: 'offers', key: 'myGoose.say.offers', params: { count: facts.offers } });
  if (facts.watchHits.length === 1) {
    const [watch] = facts.watchHits;
    clauses.push({
      shelf: 'watching',
      key: 'myGoose.say.watchOne',
      params: { title: shortTitle(watch.title), count: watch.matchingCount },
    });
  } else if (facts.watchHits.length > 1) {
    const count = facts.watchHits.reduce((sum, w) => sum + w.matchingCount, 0);
    clauses.push({ shelf: 'watching', key: 'myGoose.say.watchMany', params: { count, watches: facts.watchHits.length } });
  }
  if (facts.brief) clauses.push({ shelf: 'news', key: 'myGoose.say.brief', params: { name: facts.brief.name } });
  if (facts.reminders > 0) clauses.push({ shelf: 'reminders', key: 'myGoose.say.reminders', params: { count: facts.reminders } });
  if (facts.cart && facts.cart.count > 0) {
    clauses.push(
      facts.cart.low
        ? { shelf: 'cart', key: 'myGoose.say.cartFrom', params: { count: facts.cart.count, low: facts.cart.low } }
        : { shelf: 'cart', key: 'myGoose.say.cart', params: { count: facts.cart.count } },
    );
  }
  if (facts.ideas > 0) clauses.push({ shelf: 'ideas', key: 'myGoose.say.ideas', params: { count: facts.ideas } });
  return clauses.slice(0, SENTENCE_CLAUSES);
}

/** Where a clause of the hub's sentence takes the member. */
export type HubTarget =
  | { to: 'todos' }
  | { to: 'interview' }
  | { to: 'news' }
  | { to: 'digest'; id: string }
  | { to: 'cart'; id: string }
  | { to: 'ideas' };

export interface HubClause {
  target: HubTarget;
  key: TranslationKey | PluralKey;
  params: Record<string, string | number>;
}

export interface HubFacts {
  /** The to-dos Goose is asking about, most recently asked first. */
  checkins: { text: string }[];
  offers: number;
  /** Goose knows nothing the member is into yet. */
  newMember: boolean;
  digest: { id: string; stories: number } | null;
  stories: number;
  cart: { id: string; title: string; by: string | null; atTarget: boolean } | null;
  dueToday: number;
  idea: { title: string } | null;
}

/**
 * The hub's sentence: what needs an answer, then what Goose made, then what changed. The member's
 * answers come first because only they can give them; the news is ready whenever they are.
 */
export function hubClauses(facts: HubFacts): HubClause[] {
  const clauses: HubClause[] = [];
  const answers = facts.checkins.length + facts.offers;
  if (answers === 1 && facts.checkins.length === 1) {
    clauses.push({ target: { to: 'todos' }, key: 'goose.say.checkingOne', params: { text: shortTitle(inSentence(facts.checkins[0].text)) } });
  } else if (answers > 0) {
    clauses.push({ target: { to: 'todos' }, key: 'goose.say.asking', params: { count: answers } });
  }
  if (facts.newMember) clauses.push({ target: { to: 'interview' }, key: 'goose.say.newMember', params: {} });
  if (facts.digest) {
    clauses.push({ target: { to: 'digest', id: facts.digest.id }, key: 'goose.say.digest', params: { count: Math.max(facts.digest.stories, 1) } });
  } else if (facts.stories > 0) {
    clauses.push({ target: { to: 'news' }, key: 'goose.say.stories', params: { count: facts.stories } });
  }
  if (facts.cart?.atTarget) {
    clauses.push({ target: { to: 'cart', id: facts.cart.id }, key: 'goose.say.cartTarget', params: { title: shortTitle(headOf(facts.cart.title)) } });
  } else if (facts.cart?.by) {
    clauses.push({ target: { to: 'cart', id: facts.cart.id }, key: 'goose.say.cartDrop', params: { title: shortTitle(headOf(facts.cart.title)), by: facts.cart.by } });
  }
  if (facts.dueToday > 0) clauses.push({ target: { to: 'todos' }, key: 'goose.say.dueToday', params: { count: facts.dueToday } });
  if (facts.idea) clauses.push({ target: { to: 'ideas' }, key: 'goose.say.idea', params: { title: shortTitle(facts.idea.title) } });
  return clauses.slice(0, SENTENCE_CLAUSES);
}
