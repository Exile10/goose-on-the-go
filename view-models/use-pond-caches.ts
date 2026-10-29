// What the Pond keeps only to be quicker, and what clearing each one costs, said before it is cleared.

import { useCallback, useState } from 'react';

import { sizeWords } from '@/models/pond-admin';
import { useConfirm } from '@/providers/confirm-provider';
import i18n from '@/services/i18n';
import type { AdminCache, AdminCacheId } from '@/services/types';
import { describeApiError } from './describe-error';
import { adminRefusal } from './pond-admin-source';
import { cacheEffect, cacheLabel } from './pond-admin-words';
import { useAdminGate, useAdminLoad, type AdminGate } from './use-admin-gate';

export interface UsePondCaches {
  gate: AdminGate;
  caches: AdminCache[];
  /** What clearing every cache would free. */
  total: number;
  loading: boolean;
  failed: boolean;
  error: string | null;
  /** What each clear freed, by cache, until the screen is left. */
  freed: Partial<Record<AdminCacheId, number>>;
  /** The cache being cleared, or null. */
  clearing: AdminCacheId | null;
  actions: {
    refresh: () => Promise<void>;
    /** Asks first; resolves to whether it was cleared. */
    clear: (id: AdminCacheId) => Promise<boolean>;
  };
}

export function usePondCaches(): UsePondCaches {
  const ask = useConfirm();
  const { gate, source, noteFailure, touch } = useAdminGate();
  const [caches, setCaches] = useState<AdminCache[] | null>(null);
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freed, setFreed] = useState<Partial<Record<AdminCacheId, number>>>({});
  const [clearing, setClearing] = useState<AdminCacheId | null>(null);

  const read = useCallback(async () => {
    setReading(true);
    try {
      setCaches(await source.caches());
      setFailed(false);
      setError(null);
      touch();
    } catch (e) {
      if (noteFailure(e)) return;
      setFailed(true);
      setError(describeApiError(e) ?? i18n.t('myPond.caches.readFailed'));
    } finally {
      setReading(false);
    }
  }, [noteFailure, source, touch]);

  useAdminLoad(read, gate);

  const clear = useCallback(
    async (id: AdminCacheId) => {
      if (clearing) return false;
      const size = sizeWords(caches?.find((c) => c.id === id)?.bytes ?? 0);
      const yes = await ask({
        title: i18n.t('myPond.caches.clearTitle', { name: cacheLabel(id) }),
        message: i18n.t('myPond.caches.clearBody', { size, effect: cacheEffect(id) }),
        confirmLabel: i18n.t('myPond.caches.clearSize', { size }),
        cancelLabel: i18n.t('myPond.keepIt'),
        destructive: true,
      });
      if (!yes) return false;
      setClearing(id);
      setError(null);
      try {
        const bytes = await source.clearCache(id);
        touch();
        setFreed((all) => ({ ...all, [id]: bytes }));
        await read();
        return true;
      } catch (e) {
        if (noteFailure(e)) return false;
        if (adminRefusal(e) === 'unknown_cache') {
          setError(i18n.t('myPond.caches.unknown'));
          await read();
        } else {
          setError(describeApiError(e) ?? i18n.t('myPond.caches.clearFailed'));
        }
        return false;
      } finally {
        setClearing(null);
      }
    },
    [ask, caches, clearing, noteFailure, read, source, touch],
  );

  return {
    gate,
    caches: caches ?? [],
    total: (caches ?? []).reduce((sum, c) => sum + c.bytes, 0),
    loading: reading && caches === null,
    failed,
    error,
    freed,
    clearing,
    actions: { refresh: read, clear },
  };
}
