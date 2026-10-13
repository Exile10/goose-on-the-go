/**
 * Memories — what the Pond has learned about the household.
 *
 * A poll, because the Pond writes memories in the background (extraction after
 * a conversation, consolidation merging and pruning) and has no event stream
 * for them. Behind the Developer toggle for `memory`: on mock, the same cards
 * render `SAMPLE_MEMORIES` and the actions change them locally.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { MemoryFragment } from '@/services/types';
import { SAMPLE_MEMORIES } from '@/models/memory';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';

/** New memories come from conversations, which take minutes, not seconds. */
export const MEMORIES_MS = 60_000;

export interface UseMemories {
  data: { memories: MemoryFragment[] };
  loading: boolean;
  error: string | null;
  /** A load failed and nothing has loaded yet: unknown, not empty. See useSchedules. */
  failed: boolean;
  actions: {
    refresh: () => Promise<void>;
    remove: (memory: MemoryFragment) => Promise<void>;
  };
}

/** A 400 says why ("a memory cannot be blank"); the rest is the shared reading. */
export function describeMemoryError(e: unknown): string | null {
  if (e instanceof ApiError && e.status === 400 && e.detail) return e.detail;
  return describeApiError(e);
}

export function useMemories(): UseMemories {
  const { hydrated, isScreenReal } = useServer();
  const real = isScreenReal('memory');

  const [memories, setMemories] = useState<MemoryFragment[]>(() => (real ? [] : SAMPLE_MEMORIES));
  const [loading, setLoading] = useState(real);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // The Developer toggle swapping the source; see useSchedules.
  const [source, setSource] = useState(real);
  if (source !== real) {
    setSource(real);
    setMemories(real ? [] : SAMPLE_MEMORIES);
    setLoading(real);
    setError(null);
    setFailed(false);
  }

  const loadedFrom = useRef<boolean | null>(null);
  useEffect(() => {
    if (!real) loadedFrom.current = null;
  }, [real]);
  // A read that started before a local change must not undo it when it lands.
  const changes = useRef(0);

  const load = useCallback(
    async (loud: boolean) => {
      if (!real) return;
      if (loud) {
        setLoading(true);
        setError(null);
      }
      const startedAt = changes.current;
      try {
        const list = await api.listMemories();
        if (startedAt === changes.current) setMemories(list);
        loadedFrom.current = real;
        setError(null);
        setFailed(false);
      } catch (e) {
        if (loud || loadedFrom.current !== real) setError(describeMemoryError(e));
        else console.warn('[memories] refresh failed; showing the last result', e instanceof ApiError ? e.status : 'network');
        if (loadedFrom.current !== real) setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [real],
  );

  const refresh = useCallback(() => load(true), [load]);

  useLive(() => load(false), MEMORIES_MS, hydrated && real);

  const remove = useCallback(
    async (memory: MemoryFragment) => {
      changes.current += 1;
      setMemories((current) => current.filter((m) => m.id !== memory.id));
      if (!real) return;
      try {
        await api.deleteMemory(memory.id);
      } catch (e) {
        changes.current += 1;
        setMemories((current) => [memory, ...current.filter((m) => m.id !== memory.id)]);
        setError(describeMemoryError(e) ?? i18n.t('memories.errors.deleteFailed'));
      }
    },
    [real],
  );

  return { data: { memories }, loading, error, failed, actions: { refresh, remove } };
}
