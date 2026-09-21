/**
 * Model catalogue for the AI Models screen.
 *
 * Follows the view-model contract in docs/ARCHITECTURE.md: the screen renders
 * `data` and calls `actions`, and never touches the network itself.
 */

import { useCallback, useEffect, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import type { ModelEntry } from '@/services/types';
import { describeApiError } from './describe-error';

/**
 * Providers that run the model on the Pond itself.
 *
 * This is the one privacy claim the screen can make honestly: a local provider
 * means the prompt never leaves the house. Anything else is a cloud fallback,
 * which GIAP supports but does not assume.
 */
const LOCAL_PROVIDERS = ['ollama', 'llamafile', 'local', 'local-inference'];

export function isLocalProvider(provider: string): boolean {
  return LOCAL_PROVIDERS.includes(provider.toLowerCase());
}

/** Human-readable size, or null when the server did not say. */
export function formatSize(megabytes: number | undefined): string | null {
  if (megabytes === undefined) return null;
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(1)} GB`;
  return `${Math.round(megabytes)} MB`;
}

/** Context window in the units people read it in, or null when unknown. */
export function formatContextWindow(tokens: number | undefined): string | null {
  if (!tokens) return null;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K tokens`;
  return `${tokens} tokens`;
}

export interface UseModels {
  data: {
    models: ModelEntry[];
    /** The model currently serving chat, or null when none is active. */
    activeModel: ModelEntry | null;
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
      setModels((current) =>
        current.map((m) => ({ ...m, is_active: m.id === model.id })),
      );
      try {
        await api.activateModel(model.provider, model.name);
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
      activeModel: models.find((m) => m.is_active) ?? null,
    },
    loading,
    error,
    actions: { activate, refresh },
  };
}

function describe(e: unknown): string | null {
  if (e instanceof ApiError && e.status === 404) {
    return 'This Pond does not expose a model catalogue.';
  }
  return describeApiError(e);
}
