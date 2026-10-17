/**
 * How the Models pages write sizes and context windows. The pages' data is `use-model-library.ts`.
 */

import { MODEL_CATEGORIES, type ModelCategory, type ModelEntry } from '@/services/types';

/**
 * Human-readable size, or null when the server did not say.
 *
 * Zero is "not measured" rather than "empty": the catalogue records 0 for a
 * file found by the filesystem sweep but never sized, and "0 MB" next to a
 * multi-gigabyte model reads as a bug.
 */
export function formatSize(megabytes: number | undefined): string | null {
  if (!megabytes) return null;
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(1)} GB`;
  return `${Math.round(megabytes)} MB`;
}

/** Context window in the units people read it in, or null when unknown. */
export function formatContextWindow(tokens: number | undefined): string | null {
  if (!tokens) return null;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K tokens`;
  return `${tokens} tokens`;
}

/** Models under the category the server filed them in, empty groups dropped. */
export interface ModelGroup {
  category: ModelCategory;
  models: ModelEntry[];
}

export function groupByCategory(models: ModelEntry[]): ModelGroup[] {
  return MODEL_CATEGORIES.map((category) => ({
    category,
    models: models.filter((m) => m.category === category),
  })).filter((g) => g.models.length > 0);
}
