/**
 * Memories — what the Pond has learned about the household.
 *
 * A poll, because the Pond writes memories in the background (extraction after
 * a conversation, consolidation merging and pruning) and has no event stream
 * for them. Real by default, release builds included; in dev the Developer
 * toggle for `memory` can switch it to mock, where the same cards render
 * `SAMPLE_MEMORIES` and the actions change them locally.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, ONBOARDING_REQUIRED, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import type { MemoryFragment, SaveMemoryRequest } from '@/services/types';
import { SAMPLE_MEMORIES, unkeptTier } from '@/models/memory';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';

/** New memories come from conversations, which take minutes, not seconds. */
export const MEMORIES_MS = 60_000;

export interface UseMemories {
  data: { memories: MemoryFragment[] };
  loading: boolean;
  /** Why the last read failed. A refused forget is said in the snackbar, with Try again. */
  error: string | null;
  /** A load failed and nothing has loaded yet: unknown, not empty. See useSchedules. */
  failed: boolean;
  actions: {
    refresh: () => Promise<void>;
    /** Resolves to why the Pond refused it, or null once it is saved. */
    save: (req: SaveMemoryRequest) => Promise<string | null>;
    /** Resolves to why the Pond refused it, or null once it is reworded. */
    reword: (memory: MemoryFragment, content: string) => Promise<string | null>;
    /** Resolves to why the Pond refused it, or null once the keep has changed. */
    setKept: (memory: MemoryFragment, keep: boolean) => Promise<string | null>;
    remove: (memory: MemoryFragment) => Promise<void>;
  };
}

/**
 * A 400 says why ("a memory cannot be blank"). A 403 other than the onboarding
 * guard's is this phone being refused the memory routes, which no banner
 * explains, so it gets a sentence of its own. The rest is the shared reading.
 */
export function describeMemoryError(e: unknown): string | null {
  if (e instanceof ApiError && e.status === 400 && e.detail) return e.detail;
  if (e instanceof ApiError && e.status === 403 && e.detail !== ONBOARDING_REQUIRED) {
    return i18n.t('memories.errors.forbidden');
  }
  return describeApiError(e);
}

/**
 * A Pond from before `PUT /memories/{id}` took a tier refuses a tier alone
 * with a 422, so that says the Pond needs updating rather than that it broke.
 */
export function describeKeepError(e: unknown): string {
  if (e instanceof ApiError && e.status === 422) return i18n.t('memories.errors.keepNeedsUpdate');
  return describeMemoryError(e) ?? i18n.t('memories.errors.saveFailed');
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

  // After a change the Pond took, read the list back rather than trust the local edit alone: the
  // Pond may have trimmed the words or set a tier from the segment. Quiet, so a failed read keeps
  // the list on screen.
  const reread = useCallback(() => {
    if (real) void load(false);
  }, [real, load]);

  const save = useCallback(
    async (req: SaveMemoryRequest) => {
      try {
        const saved = real ? await api.saveMemory(req) : mockMemory(req);
        changes.current += 1;
        setMemories((current) => [saved, ...current]);
        reread();
        return null;
      } catch (e) {
        return describeMemoryError(e) ?? i18n.t('memories.errors.saveFailed');
      }
    },
    [real, reread],
  );

  const reword = useCallback(
    async (memory: MemoryFragment, content: string) => {
      try {
        if (real) await api.updateMemory(memory.id, { content });
        changes.current += 1;
        setMemories((current) => current.map((m) => (m.id === memory.id ? { ...m, content } : m)));
        reread();
        return null;
      } catch (e) {
        return describeMemoryError(e) ?? i18n.t('memories.errors.saveFailed');
      }
    },
    [real, reread],
  );

  // Sent on its own, never beside new words, so an older Pond refuses it
  // instead of ignoring it (see `UpdateMemoryRequest`).
  const setKept = useCallback(
    async (memory: MemoryFragment, keep: boolean) => {
      const tier = keep ? 'permanent' : unkeptTier(memory.segment);
      try {
        if (real) await api.updateMemory(memory.id, { tier });
        changes.current += 1;
        setMemories((current) => current.map((m) => (m.id === memory.id ? { ...m, tier } : m)));
        reread();
        return null;
      } catch (e) {
        return describeKeepError(e);
      }
    },
    [real, reread],
  );

  // What the snackbar's Try again calls: the current `remove`, set below once it is made.
  const retryRemove = useRef<(memory: MemoryFragment) => Promise<void>>(async () => {});

  const remove = useCallback(
    async (memory: MemoryFragment) => {
      changes.current += 1;
      setMemories((current) => current.filter((m) => m.id !== memory.id));
      if (!real) return;
      try {
        await api.deleteMemory(memory.id);
        reread();
      } catch (e) {
        changes.current += 1;
        setMemories((current) => [memory, ...current.filter((m) => m.id !== memory.id)]);
        console.warn('[memories] forget refused', e instanceof ApiError ? e.status : 'network');
        showSnackbar({
          message: describeMemoryError(e) ?? i18n.t('memories.errors.deleteFailed'),
          tone: 'danger',
          action: { label: i18n.t('common.retry'), onPress: () => void retryRemove.current(memory) },
        });
      }
    },
    [real, reread],
  );
  useEffect(() => {
    retryRemove.current = remove;
  }, [remove]);

  return { data: { memories }, loading, error, failed, actions: { refresh, save, reword, setKept, remove } };
}

/** The fragment the Pond would send back, without the Pond. */
function mockMemory(req: SaveMemoryRequest): MemoryFragment {
  return {
    id: `mock-${Date.now()}`,
    profile_id: null,
    session_id: null,
    content: req.content,
    source: req.source ?? 'api',
    tags: req.tags ?? [],
    created_at: new Date().toISOString(),
    segment: req.segment,
    importance: req.importance,
    tier: req.tier,
    access_count: 0,
    lifecycle: 'active',
  };
}
