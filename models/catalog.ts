// "More your Goose can do": what this Pond has switched on, each with a prompt to try or a screen
// to open (docs/MY-GOOSE-HUB.md, part 7).

import type { CatalogOpensWire } from '@/services/types';

import { oneOf, readAll, record, text, textOrNull } from './me-read';

export type CatalogOpens = CatalogOpensWire;
const OPENS: readonly CatalogOpens[] = ['news', 'todos', 'cart', 'connectors', 'ideas', 'interests', 'agents', 'web_watches', 'cameras', 'voice', 'models', 'settings'];

export interface CatalogItem {
  id: string;
  title: string;
  body: string;
  /** The Pond's name for its glyph; the screen draws a sparkle when the app has no such glyph. */
  icon: string;
  state: 'on' | 'off' | 'needs_setup';
  try: string | null;
  opens: CatalogOpens | null;
}

export function readCatalogItem(raw: unknown): CatalogItem | null {
  const r = record(raw);
  const id = text(r?.id);
  const title = text(r?.title);
  if (!r || !id || !title) return null;
  return {
    id,
    title,
    body: text(r.body),
    icon: text(r.icon),
    // An unknown state is "off": the phone never says a thing is on that it cannot see is.
    state: oneOf(r.state, ['on', 'off', 'needs_setup'] as const, 'off'),
    try: textOrNull(r.try),
    // A screen this phone does not have is no destination; the item keeps its prompt.
    opens: OPENS.find((o) => o === r.opens) ?? null,
  };
}

export function readCatalog(raw: unknown): CatalogItem[] {
  return readAll(raw, 'items', readCatalogItem);
}

/** Where `opens` goes in this app. */
export type CatalogHref =
  | '/(stack)/goose-news'
  | '/(stack)/goose-todos'
  | '/(stack)/goose-cart'
  | '/(stack)/goose-connectors'
  | '/(stack)/goose-ideas'
  | '/(stack)/goose-interests'
  | '/(stack)/agents'
  | '/(stack)/web-watches'
  | '/(stack)/settings-cameras'
  | '/(stack)/settings-voice'
  | '/(stack)/models'
  | '/(tabs)/profile';

export function catalogHref(opens: CatalogOpens): CatalogHref {
  switch (opens) {
    case 'news': return '/(stack)/goose-news';
    case 'todos': return '/(stack)/goose-todos';
    case 'cart': return '/(stack)/goose-cart';
    case 'connectors': return '/(stack)/goose-connectors';
    case 'ideas': return '/(stack)/goose-ideas';
    case 'interests': return '/(stack)/goose-interests';
    case 'agents': return '/(stack)/agents';
    case 'web_watches': return '/(stack)/web-watches';
    case 'cameras': return '/(stack)/settings-cameras';
    case 'voice': return '/(stack)/settings-voice';
    case 'models': return '/(stack)/models';
    case 'settings': return '/(tabs)/profile';
  }
}
