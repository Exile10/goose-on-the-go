/**
 * Saved cards ViewModel: the member's cards and the household's shared ones, by collection, and
 * what a member does with one of theirs (share it, move it, delete it, watch its price).
 */

import { useCallback, useState } from 'react';

import type { SavedCollection, SavedItem } from '@/models/web-watches';
import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { useLive } from './use-live';

/** A card shared or moved on another phone shows up without leaving the screen. */
export const SAVED_MS = 60_000;

function failure(e: unknown): string {
  return e instanceof ApiError ? i18n.t('saved.errors.status', { status: e.status }) : i18n.t('saved.errors.unreachable');
}

export function useSavedItems() {
  const { hydrated } = useServer();
  const [items, setItems] = useState<SavedItem[]>([]);
  const [collections, setCollections] = useState<SavedCollection[]>([]);
  const [collection, setCollection] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** `loud` is a read somebody asked for; one on arrival or a poll changes nothing until it lands. */
  const load = useCallback(async (loud: boolean, from: string | null) => {
    if (loud) {
      setLoading(true);
      setError(null);
    }
    try {
      const [found, named] = await Promise.all([api.listSavedItems(from ?? undefined), api.savedCollections()]);
      setItems(found);
      setCollections(named);
      setError(null);
    } catch (e) {
      setError(failure(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load(true, collection), [load, collection]);
  useLive(() => load(false, collection), SAVED_MS, hydrated);

  /** Another collection is read at once, rather than at the next poll. */
  const choose = useCallback(
    (next: string | null) => {
      setCollection(next);
      void load(true, next);
    },
    [load],
  );

  return { data: { items, collections, collection }, loading, error, actions: { refresh, setCollection: choose } };
}

export function useSavedItem(id: string) {
  const { hydrated } = useServer();
  const [item, setItem] = useState<SavedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const [watching, setWatching] = useState(false);

  /** `loud` is a read somebody asked for; one on arrival or a poll changes nothing until it lands. */
  const load = useCallback(async (loud: boolean) => {
    if (!id) return;
    if (loud) {
      setLoading(true);
      setError(null);
    }
    try {
      setItem(await api.savedItem(id));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setGone(true);
      else setError(failure(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const refresh = useCallback(() => load(true), [load]);
  useLive(() => load(false), SAVED_MS, hydrated);

  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (e) {
      setError(failure(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const share = useCallback(
    async (shared: boolean) => {
      const saved = await run(() => api.editSavedItem(id, { shared }));
      if (saved) setItem(saved);
    },
    [id, run],
  );

  const remove = useCallback(async () => {
    const done = await run(async () => {
      await api.deleteSavedItem(id);
      return true;
    });
    if (done) setGone(true);
    return done === true;
  }, [id, run]);

  const watchPrice = useCallback(async () => {
    const watch = await run(() => api.watchSavedItem(id));
    if (watch) setWatching(true);
    return watch;
  }, [id, run]);

  return { item, loading, error, busy, gone, watching, actions: { refresh, share, remove, watchPrice } };
}
