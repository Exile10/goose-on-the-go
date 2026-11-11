// Links the member asked Goose to watch for price and stock (docs/MY-GOOSE-HUB.md, part 4). Kept
// listings, the other half of the cart, stay in `models/my-goose.ts`.

import type { CartWriteWire } from '@/services/types';

import { count, list, oneOf, pondPath, readAll, readMoney, record, siteOf, text, textOrNull, time, webUrl, type Money } from './me-read';

export type CartNotify = 'drop' | 'target' | 'stock' | 'any';
export const NOTIFY_CHOICES: readonly CartNotify[] = ['drop', 'target', 'stock', 'any'];
export type CartStatus = 'ok' | 'checking' | 'failing';

export interface PricePoint {
  at: string;
  amount: number;
}

export interface CartItem {
  id: string;
  url: string;
  title: string;
  picture: string | null;
  site: string;
  price: Money | null;
  previous: Money | null;
  lowest: Money | null;
  highest: Money | null;
  target: Money | null;
  inStock: boolean | null;
  history: PricePoint[];
  status: CartStatus;
  checkedAt: string | null;
  nextCheckAt: string | null;
  everyHours: number;
  collection: string | null;
  notify: CartNotify;
}

/** Hours between checks the member can pick; the Pond keeps whatever it is sent. */
export const CHECK_EVERY = [6, 12, 24, 48] as const;

export function readCartItem(raw: unknown): CartItem | null {
  const r = record(raw);
  const id = text(r?.id);
  const url = webUrl(r?.url);
  if (!r || !id || !url) return null;
  const history = list(r.history)
    .flatMap((p) => {
      const o = record(p);
      const at = time(o?.at);
      const amount = o?.amount;
      return at && typeof amount === 'number' && Number.isFinite(amount) ? [{ at, amount }] : [];
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return {
    id,
    url,
    title: text(r.title) || siteOf(url),
    picture: pondPath(r.picture),
    site: text(r.site) || siteOf(url),
    price: readMoney(r.price),
    previous: readMoney(r.previous),
    lowest: readMoney(r.lowest),
    highest: readMoney(r.highest),
    target: readMoney(r.target),
    inStock: typeof r.in_stock === 'boolean' ? r.in_stock : null,
    history,
    status: oneOf(r.status, ['ok', 'checking', 'failing'] as const, 'ok'),
    checkedAt: time(r.checked_at),
    nextCheckAt: time(r.next_check_at),
    everyHours: count(r.every_hours) || 24,
    collection: textOrNull(r.collection),
    // An unknown choice reads as the quietest one the member could have made.
    notify: oneOf(r.notify, NOTIFY_CHOICES, 'drop'),
  };
}

export function readCart(raw: unknown): CartItem[] {
  return readAll(raw, 'items', readCartItem);
}

export type PriceMove = { direction: 'down' | 'up'; by: Money } | null;

/** How the price moved since the check before, in the same currency, or null when it did not. */
export function priceMove(item: Pick<CartItem, 'price' | 'previous'>): PriceMove {
  const { price, previous } = item;
  if (!price || !previous || price.currency !== previous.currency || price.amount === previous.amount) return null;
  const by = { amount: Math.abs(price.amount - previous.amount), currency: price.currency };
  return { direction: price.amount < previous.amount ? 'down' : 'up', by };
}

/** At or under what the member is waiting to pay. */
export function atTarget(item: Pick<CartItem, 'price' | 'target'>): boolean {
  return !!item.price && !!item.target && item.price.currency === item.target.currency && item.price.amount <= item.target.amount;
}

/** The lowest the Pond has seen, when the price now is it. */
export function atLowest(item: Pick<CartItem, 'price' | 'lowest' | 'history'>): boolean {
  if (!item.price || !item.lowest || item.history.length < 2) return false;
  return item.price.currency === item.lowest.currency && item.price.amount <= item.lowest.amount;
}

/**
 * The price history as points in a box of `width` by `height`, oldest on the left, for a small line
 * drawn under a link. Flat history is drawn across the middle; fewer than two points draws nothing.
 */
export function sparkline(history: readonly PricePoint[], width: number, height: number, pad = 2): { x: number; y: number }[] {
  if (history.length < 2) return [];
  const amounts = history.map((p) => p.amount);
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  const span = high - low;
  const first = Date.parse(history[0].at);
  const last = Date.parse(history[history.length - 1].at);
  const across = last - first;
  return history.map((p, i) => ({
    x: pad + (across > 0 ? (Date.parse(p.at) - first) / across : i / (history.length - 1)) * (width - pad * 2),
    y: span > 0 ? pad + (1 - (p.amount - low) / span) * (height - pad * 2) : height / 2,
  }));
}

/** The points as an SVG path. */
export function sparklinePath(points: readonly { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

/** The currency a typed target is in when no watched link has told the phone one yet. */
export const DEFAULT_CURRENCY = 'KSh';

/** The currency the member's watched links are priced in, for a target typed as a bare number. */
export function cartCurrency(items: readonly Pick<CartItem, 'price'>[]): string {
  return items.find((i) => i.price)?.price?.currency || DEFAULT_CURRENCY;
}

/** A typed amount as the Pond takes a target, in the currency the link is priced in. */
export function targetFrom(typed: string, currency: string): Money | null {
  const amount = Number(typed.replace(/[^\d.]/g, ''));
  return typed.trim() && Number.isFinite(amount) && amount > 0 ? { amount, currency } : null;
}

export function cartWrite(edit: { target?: Money | null; notify?: CartNotify; everyHours?: number; collection?: string | null }): CartWriteWire {
  const out: CartWriteWire = {};
  if (edit.target !== undefined) out.target = edit.target;
  if (edit.notify !== undefined) out.notify = edit.notify;
  if (edit.everyHours !== undefined) out.every_hours = edit.everyHours;
  if (edit.collection !== undefined) out.collection = edit.collection;
  return out;
}

/** A pasted link the Pond can watch: http(s), with any surrounding words taken off. */
export function linkFromPaste(pasted: string): string | null {
  const found = /https?:\/\/[^\s<>"']+/i.exec(pasted.trim());
  return found ? found[0].replace(/[).,;]+$/, '') : null;
}
