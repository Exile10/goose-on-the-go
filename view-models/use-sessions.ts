/**
 * Sessions ViewModel
 * Lists, renames, and deletes conversations against the real Pond server.
 */

import { useState, useCallback } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import type { SessionSummary } from '@/services/types';
import i18n from '@/services/i18n';
import { useLive } from './use-live';

/** A conversation started or renamed elsewhere shows up without leaving the screen. */
export const SESSIONS_MS = 60_000;

export function useSessions() {
  // The base URL and bearer token arrive asynchronously; fetching before they
  // land calls the default address unauthenticated and never retries.
  const { hydrated } = useServer();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** `loud` is a read somebody asked for; one on arrival or a poll changes nothing until it lands. */
  const load = useCallback(async (loud: boolean) => {
    if (loud) {
      setLoading(true);
      setError(null);
    }
    try {
      setSessions(await api.listSessions());
      setError(null);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? i18n.t('sessions.loadFailed', { status: e.status })
          : i18n.t('sessions.unreachable'),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load(true), [load]);
  useLive(() => load(false), SESSIONS_MS, hydrated);

  const rename = useCallback(async (id: string, title: string) => {
    try {
      await api.renameSession(id, title);
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
    } catch {
      setError(i18n.t('sessions.renameFailed'));
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await api.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      setError(i18n.t('sessions.deleteFailed'));
    }
  }, []);

  return {
    data: { sessions },
    loading,
    error,
    actions: { refresh, rename, remove },
  };
}
