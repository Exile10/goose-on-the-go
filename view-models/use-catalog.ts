// "More your Goose can do": what this Pond has switched on (docs/MY-GOOSE-HUB.md, part 7).

import type { CatalogItem } from '@/models/catalog';
import { useHubRead } from './hub-read';

export function useCatalog(enabled = true) {
  return useHubRead<CatalogItem[]>('catalog', (s) => s.catalog(), [], 30 * 60_000, enabled);
}
