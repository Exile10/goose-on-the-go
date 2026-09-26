/**
 * Model catalogue for the AI Models screen.
 *
 * Follows the view-model contract in docs/ARCHITECTURE.md: the screen renders
 * `data` and calls `actions`, and never touches the network itself.
 */

import { useCallback, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import { MODEL_CATEGORIES } from '@/services/types';
import type { ModelCategory, ModelEntry } from '@/services/types';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';
import i18n from '@/services/i18n';

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

export interface UseModels {
  data: {
    models: ModelEntry[];
    /** The same models under their category, in the server's own order. */
    groups: ModelGroup[];
    /** Models assigned to a role. A Pond serves several at once — one for
        chat, one for speech, one for embeddings — so this is a list. */
    active: ModelEntry[];
  };
  loading: boolean;
  error: string | null;
  actions: {
    activate: (model: ModelEntry) => Promise<void>;
    refresh: () => Promise<void>;
  };
}


/** Which model is loaded, and what finished downloading, changes on the Pond and not here. */
export const MODELS_MS = 60_000;

export function useModels(): UseModels {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The base URL and bearer token arrive asynchronously; fetching before they
  // land calls the default address unauthenticated and never retries.
  const { hydrated } = useServer();

  // Whether a read has ever succeeded. After one, a failed poll keeps what is on screen.
  const loaded = useRef(false);

  /** `loud` is a read somebody asked for; a poll is quiet and keeps the last good data. */
  const load = useCallback(async (loud: boolean) => {
    if (loud) {
      setLoading(true);
      setError(null);
    }
    try {
      setModels(await api.listModels());
      loaded.current = true;
      setError(null);
    } catch (e) {
      if (loud || !loaded.current) setError(describe(e));
      else console.warn('[models] refresh failed; showing the last result', e instanceof ApiError ? e.status : 'network');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load(true), [load]);

  useLive(() => load(false), MODELS_MS, hydrated);

  /**
   * Activate optimistically, then reconcile with the server.
   *
   * Switching models makes the Pond load weights, which is slow enough that an
   * un-acknowledged tap reads as a broken button. On failure the previous
   * selection is restored rather than left showing a model that is not running.
   */
  const activate = useCallback(
    async (model: ModelEntry) => {
      const previous = models;
      // Only rows of the same category change: activating a voice does not
      // unassign the language model, because they hold different roles.
      setModels((current) =>
        current.map((m) =>
          m.category === model.category ? { ...m, active: m.id === model.id } : m,
        ),
      );
      try {
        await api.activateModel(model.category, model.name);
        setModels(await api.listModels());
      } catch (e) {
        setModels(previous);
        setError(describe(e));
      }
    },
    [models],
  );

  return {
    data: {
      models,
      groups: groupByCategory(models),
      active: models.filter((m) => m.active),
    },
    loading,
    error,
    actions: { activate, refresh },
  };
}

function describe(e: unknown): string | null {
  if (e instanceof ApiError && e.status === 404) {
    return i18n.t('errors.noModelCatalogue');
  }
  return describeApiError(e);
}
