/**
 * The most recent conversations, for the home tab's history strip.
 *
 * Deliberately narrow: this is the summary list, not the chat surface. Opening
 * a session and streaming a turn belongs to #9.
 */

import { useCallback, useEffect, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import type { SessionSummary } from '@/services/types';
import { describeApiError } from './describe-error';

/** How many the home strip shows. The screen has room for a handful. */
const RECENT_LIMIT = 3;

/**
 * Render a timestamp the way the strip reads: relative for anything recent,
 * absolute once "14 days ago" stops being easier than a date.
 */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'Yesterday';

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

/** What the strip needs from a session: a line of text and when it happened. */
export interface RecentSession {
  id: string;
  /** The session's title, falling back to how the conversation opened. */
  text: string;
  time: string;
}

export interface UseRecentSessions {
  data: { sessions: RecentSession[] };
  loading: boolean;
  error: string | null;
  actions: { refresh: () => Promise<void> };
}

export function useRecentSessions(): UseRecentSessions {
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The base URL and bearer token arrive asynchronously; fetching before they
  // land calls the default address unauthenticated and never retries.
  const { hydrated } = useServer();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await api.listSessions();
      setSessions(all.slice(0, RECENT_LIMIT).map(toRecent));
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void refresh();
  }, [hydrated, refresh]);

  return { data: { sessions }, loading, error, actions: { refresh } };
}

/**
 * A session with no title and no preview is a real state — the title is derived
 * from the first user message and is absent until a turn has been persisted — so
 * it gets a name rather than an empty row.
 */
function toRecent(s: SessionSummary): RecentSession {
  return {
    id: s.id,
    text: s.title?.trim() || s.preview?.trim() || 'Untitled conversation',
    time: formatRelativeTime(s.updated_at),
  };
}
