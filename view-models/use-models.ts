/**
 * Model catalogue for the AI Models screen.
 *
 * Follows the view-model contract in docs/ARCHITECTURE.md: the screen renders
 * `data` and calls `actions`, and never touches the network itself.
 */

import { useCallback, useEffect, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import { MODEL_CATEGORIES } from '@/services/types';
import type { ModelCategory, ModelEntry } from '@/services/types';

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

export function useModels(): UseModels {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The base URL and bearer token arrive asynchronously; fetching before they
  // land calls the default address unauthenticated and never retries.
  const { hydrated } = useServer();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setModels(await api.listModels());
    } catch (e) {
      setError(describe(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void refresh();
  }, [hydrated, refresh]);

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

function describe(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return 'This Pond does not expose a model catalogue.';
    if (e.isRetryable) return 'Your Pond is busy. Try again in a moment.';
    return `Your Pond refused the request (HTTP ${e.status}).`;
  }
  return 'Could not reach your Pond. Check that it is running on this network.';
}
