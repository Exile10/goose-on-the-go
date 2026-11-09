/**
 * Web watches ViewModel: the member's watches, one watch with its changes, and the few things a
 * member changes on one (pause, how often, stop).
 */

import { useCallback, useEffect, useState } from 'react';

import type { WebWatch, WebWatchDetail } from '@/models/web-watches';
import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';

/** Hours a member may pick between checks; the Pond keeps any value from 1 to 168. */
export const WATCH_INTERVALS = [1, 3, 6, 12, 24] as const;

function failure(e: unknown): string {
  return e instanceof ApiError ? i18n.t('webWatches.errors.status', { status: e.status }) : i18n.t('webWatches.errors.unreachable');
}

export function useWebWatches() {
  const { hydrated } = useServer();
  const [watches, setWatches] = useState<WebWatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWatches(await api.listWebWatches());
    } catch (e) {
      setError(failure(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void refresh();
  }, [hydrated, refresh]);

  return { data: { watches }, loading, error, actions: { refresh } };
}

export function useWebWatch(id: string) {
  const { hydrated } = useServer();
  const [watch, setWatch] = useState<WebWatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [gone, setGone] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setWatch(await api.webWatch(id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setGone(true);
      else setError(failure(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!hydrated) return;
    void refresh();
  }, [hydrated, refresh]);

  const edit = useCallback(
    async (change: { paused?: boolean; interval_hours?: number }) => {
      setSaving(true);
      setError(null);
      try {
        const saved = await api.editWebWatch(id, change);
        setWatch((w) => (w ? { ...w, ...saved } : w));
        return true;
      } catch (e) {
        setError(failure(e));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [id],
  );

  const stop = useCallback(async () => {
    setSaving(true);
    try {
      await api.deleteWebWatch(id);
      setGone(true);
      return true;
    } catch (e) {
      setError(failure(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [id]);

  return { watch, loading, error, saving, gone, actions: { refresh, edit, stop } };
}
