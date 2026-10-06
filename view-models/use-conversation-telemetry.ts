/**
 * Latest conversation — how Goose's most recent conversation went, from the
 * Pond's telemetry, for the card on the Activity screen (issue #15).
 *
 * The Pond keeps telemetry per conversation only (`session_id` is required),
 * so this finds the newest conversation first and asks about that one.
 *
 * Like the day's counts, the card is a glance: a failed poll keeps the last
 * figures, and a first read that fails leaves the card off.
 *
 * Behind the Developer toggle for `logs`: on mock, the sample conversation.
 */

import { useCallback, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import type { SessionSummary, TelemetrySummary, TurnMetrics } from '@/services/types';
import { SAMPLE_SESSION, SAMPLE_TELEMETRY, SAMPLE_TURNS, latestSession } from '@/models/telemetry';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';
import { SUMMARY_MS } from './use-activity-summary';

export interface ConversationTelemetry {
  session: SessionSummary;
  summary: TelemetrySummary;
}

export interface UseConversationTelemetry {
  /** `null` until a read lands, and when there is no conversation to show. */
  data: { latest: ConversationTelemetry | null };
}

const SAMPLE_LATEST: ConversationTelemetry = { session: SAMPLE_SESSION, summary: SAMPLE_TELEMETRY };

export function useConversationTelemetry(): UseConversationTelemetry {
  const { hydrated, isScreenReal } = useServer();
  const real = isScreenReal('logs');

  const [latest, setLatest] = useState<ConversationTelemetry | null>(() => (real ? null : SAMPLE_LATEST));

  // The Developer toggle swapping the source; see useActivity.
  const [source, setSource] = useState(real);
  if (source !== real) {
    setSource(real);
    setLatest(real ? null : SAMPLE_LATEST);
  }

  const load = useCallback(async () => {
    if (!real) return;
    try {
      const session = latestSession(await api.listSessions());
      // A conversation with no turns has nothing to show yet.
      const summary = session ? await api.telemetrySummary(session.id) : null;
      setLatest(session && summary && summary.total_turns > 0 ? { session, summary } : null);
    } catch (e) {
      console.warn('[telemetry] read failed; keeping the last figures', e instanceof ApiError ? e.status : 'network');
    }
  }, [real]);

  useLive(load, SUMMARY_MS, hydrated && real);

  return { data: { latest } };
}

export interface UseConversationTurns {
  data: { turns: TurnMetrics[] };
  loading: boolean;
  error: string | null;
  /** Read one conversation's turns; the sheet calls it when it opens. */
  actions: { load: (sessionId: string) => Promise<void> };
}

/**
 * Every turn of one conversation, read when asked rather than polled: a
 * finished turn does not change, and nobody needs them behind a closed sheet.
 */
export function useConversationTurns(): UseConversationTurns {
  const { isScreenReal } = useServer();
  const real = isScreenReal('logs');

  const [turns, setTurns] = useState<TurnMetrics[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (sessionId: string) => {
      setError(null);
      if (!real) {
        setTurns(SAMPLE_TURNS);
        return;
      }
      // Another conversation's turns must not show while this one's load.
      setTurns([]);
      setLoading(true);
      try {
        setTurns(await api.telemetryTurns(sessionId));
      } catch (e) {
        setError(describeApiError(e));
      } finally {
        setLoading(false);
      }
    },
    [real],
  );

  return { data: { turns }, loading, error, actions: { load } };
}
