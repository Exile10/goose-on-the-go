/**
 * How the Activity screen reads the Pond's per-conversation telemetry
 * (`/telemetry/summary` and `/telemetry/turns`, issue #15): which conversation
 * to show, and the figures written the way a person reads them.
 *
 * The Pond keeps telemetry per conversation only, so the screen shows the
 * latest one rather than a household-wide total it does not have.
 */

import type { SessionSummary, TelemetrySummary, TurnMetrics } from '@/services/types';

/** The conversation touched most recently, or `null` when there are none. */
export function latestSession(sessions: SessionSummary[]): SessionSummary | null {
  let latest: SessionSummary | null = null;
  for (const session of sessions) {
    if (!latest || Date.parse(session.updated_at) > Date.parse(latest.updated_at)) latest = session;
  }
  return latest;
}

/** Milliseconds below a second, then seconds to one place: "320 ms", "1.4 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** A 0–100 share, whole: "42%". */
export function formatPercent(pct: number): string {
  return `${Math.round(pct)}%`;
}

// ── Mock path ────────────────────────────────────────────────────────────────

export const SAMPLE_SESSION: SessionSummary = {
  id: 'sample-session',
  title: 'Porch light at sunset',
  created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
  updated_at: new Date(Date.now() - 12 * 60_000).toISOString(),
};

export const SAMPLE_TURNS: TurnMetrics[] = [
  {
    session_id: SAMPLE_SESSION.id,
    turn_number: 1,
    prompt_tokens: 1840,
    completion_tokens: 96,
    ttft_ms: 410,
    total_latency_ms: 2300,
    tool_name: 'home.set_schedule',
    tool_latency_ms: 180,
    context_utilization_pct: 22,
    model_name: 'qwen3-4b',
    timestamp: SAMPLE_SESSION.created_at,
  },
  {
    session_id: SAMPLE_SESSION.id,
    turn_number: 2,
    prompt_tokens: 2210,
    completion_tokens: 54,
    ttft_ms: 350,
    total_latency_ms: 1200,
    tool_name: null,
    tool_latency_ms: null,
    context_utilization_pct: 27,
    model_name: 'qwen3-4b',
    timestamp: SAMPLE_SESSION.updated_at,
  },
];

export const SAMPLE_TELEMETRY: TelemetrySummary = {
  avg_ttft_ms: 380,
  avg_completion_tokens: 75,
  total_turns: SAMPLE_TURNS.length,
  avg_context_utilization: 24.5,
};
