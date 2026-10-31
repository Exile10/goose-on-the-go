/**
 * The most recent conversations, for the home tab's history strip.
 *
 * Deliberately narrow: this is the summary list, not the chat surface. Opening
 * a session and streaming a turn belongs to #9.
 */

import { useCallback, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import type { SessionSummary } from '@/services/types';
import { describeApiError, logFailure } from './describe-error';
import { useLive } from './use-live';
import i18n from '@/services/i18n';

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
  if (minutes < 1) return i18n.t('sessions.justNow');
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return i18n.t('sessions.yesterday');

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

/** What the strip needs from a session: a line of text and when it happened. */
export interface RecentSession {
  id: string;
  /** The session's title, falling back to how the conversation opened. */
  text: string;
  /** The title alone, for the conversation's own bar: the preview is not a name. */
  title: string | null;
  /**
   * How the conversation opened, for a second line under the name. Null when the Pond sent none,
   * and when it is what `text` already shows -- a row must not say the same thing twice.
   */
  preview: string | null;
  time: string;
}

export interface UseRecentSessions {
  data: { sessions: RecentSession[] };
  loading: boolean;
  /** No read has worked yet and the last one failed: the strip is unknown, not empty. */
  failed: boolean;
  /** Words for that failure, when there are any beyond the shared ones. */
  error: string | null;
  actions: { refresh: () => Promise<void> };
}


/** Conversations started on the desktop or by voice should appear without leaving Home. */
export const RECENT_SESSIONS_MS = 30_000;

export function useRecentSessions(): UseRecentSessions {
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // The base URL and bearer token arrive asynchronously; fetching before they
  // land calls the default address unauthenticated and never retries.
  const { hydrated } = useServer();

  // Whether a read has ever succeeded. After one, a failed poll keeps what is on screen.
  const loaded = useRef(false);

  /** `loud` is a read somebody asked for; a poll is quiet and keeps the last good data. */
  const load = useCallback(async (loud: boolean) => {
    if (loud) {
      setLoading(true);
      setError(null);
    }
    try {
      const all = await api.listSessions();
      setSessions(all.slice(0, RECENT_LIMIT).map(toRecent));
      loaded.current = true;
      setError(null);
      setFailed(false);
    } catch (e) {
      if (loud || !loaded.current) {
        setError(describeApiError(e));
        logFailure('recent', 'read failed', e);
      } else logFailure('recent', 'refresh failed; showing the last result', e);
      if (!loaded.current) setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load(true), [load]);

  useLive(() => load(false), RECENT_SESSIONS_MS, hydrated);

  return { data: { sessions }, loading, failed, error, actions: { refresh } };
}

/**
 * A session with no title and no preview is a real state — the title is derived
 * from the first user message and is absent until a turn has been persisted — so
 * it gets a name rather than an empty row.
 *
 * Pure, so the mapping is testable without a Pond.
 */
export function toRecent(s: SessionSummary): RecentSession {
  const title = s.title?.trim() || null;
  const preview = s.preview?.trim() || null;
  const text = title || preview || i18n.t('sessions.untitled');
  return {
    id: s.id,
    text,
    title,
    // Compared against the line that is actually drawn, not against the title: with no title the
    // preview is already that line, and a row must not print it twice.
    preview: preview && preview !== text ? preview : null,
    time: formatRelativeTime(s.updated_at),
  };
}
