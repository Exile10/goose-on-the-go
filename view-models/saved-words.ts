// What a saved card says about itself in a list: its kind's name, and the one line that tells cards
// of a kind apart (a listing's price, a recipe's time, a place's address).

import type { TranslationKey } from '@/services/i18n';
import type { SavedItem, SavedKind } from '@/models/web-watches';

const KIND_KEYS: Record<SavedKind, TranslationKey> = {
  recipe: 'saved.kinds.recipe',
  listing: 'saved.kinds.listing',
  place: 'saved.kinds.place',
  report: 'saved.kinds.report',
  note: 'saved.kinds.note',
};

export function savedKindKey(kind: SavedKind): TranslationKey {
  return KIND_KEYS[kind];
}

/** The card's one distinguishing line, or '' when its kind has nothing to add. */
export function savedSummary(item: SavedItem): string {
  switch (item.kind) {
    case 'listing': {
      const price = item.price && item.currency && !item.price.includes(item.currency) ? `${item.currency} ${item.price}` : item.price;
      return [price, item.mileage, item.year, item.location].filter(Boolean).join(' · ');
    }
    case 'recipe':
      return [item.time, item.servings].filter(Boolean).join(' · ');
    case 'place':
      return [item.address, item.hours].filter(Boolean).join(' · ');
    default: {
      const first = item.body.split('\n').map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('#'));
      return first ?? '';
    }
  }
}
