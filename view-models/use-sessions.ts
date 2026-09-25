/**
 * Sessions ViewModel
 * Lists, renames, and deletes conversations against the real Pond server.
 */

import { useState, useCallback, useEffect } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import type { SessionSummary } from '@/services/types';

export function useSessions() {
  // The base URL and bearer token arrive asynchronously; fetching before they
  // land calls the default address unauthenticated and never retries.
  const { hydrated } = useServer();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listSessions();
      setSessions(result);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? `Could not load conversations (HTTP ${e.status}).`
          : 'Could not reach your Pond.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void refresh();
  }, [hydrated, refresh]);

  const rename = useCallback(async (id: string, title: string) => {
    try {
      await api.renameSession(id, title);
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
    } catch {
      setError('Failed to rename conversation.');
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await api.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      setError('Failed to delete conversation.');
    }
  }, []);

  return {
    data: { sessions },
    loading,
    error,
    actions: { refresh, rename, remove },
  };
}
