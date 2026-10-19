/**
 * Suggestions: the Pond's proactive proposals, each waiting for a yes or no from
 * the one household member it is addressed to.
 *
 * The user-facing word is "suggestion"; the Pond's is "proposal", and the chat's
 * `useSuggestions` is a different thing (questions to ask, which need no decision).
 *
 * Both proposal routes require a `session_id` and refuse a blank one. The phone has
 * no conversation open here, and borrowing one from the household's session list
 * would be wrong: the Pond binds an unattributed session to the device's member on
 * read, so opening this screen would quietly claim somebody else's conversation. So
 * each screen visit makes up its own random label that names no session. Who the
 * caller is comes from the paired device (or, on a one-member Pond, from the only
 * member); the label only satisfies the "not blank" rule.
 */

import { bytesToHex } from '@noble/hashes/utils.js';
import { useCallback, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, ONBOARDING_REQUIRED, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { randomBytes } from '@/services/secure-random';
import type { Proposal, ProposalDecision } from '@/services/types';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';

/** A proposal lives for hours, not seconds; the Pond filters expiry itself. */
export const PROPOSALS_MS = 60_000;

/** One suggestion as the list shows it. */
export interface ProposalRow {
  id: string;
  summary: string;
  /** Why the Pond is suggesting it. Always shown, never folded into the summary. */
  rationale: string;
  /** When it stops being offered, already formatted. */
  expires: string;
}

/** Pure, so the mapping is testable without a Pond. */
export function toProposalRow(proposal: Proposal, locale?: string): ProposalRow {
  const expires = new Date(proposal.expires_at);
  return {
    id: proposal.id,
    summary: proposal.summary.trim(),
    rationale: proposal.rationale.trim(),
    expires: Number.isNaN(expires.getTime())
      ? ''
      : expires.toLocaleString(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' }),
  };
}

/**
 * The sentence for a refused proposal request. A 403 here is not the phone losing
 * its pairing (that is a 401): it is the Pond unable to tell which household member
 * is asking, which the shared reading would hide as "the banner already says it".
 */
export function describeProposalError(e: unknown): string | null {
  if (e instanceof ApiError && e.status === 403 && e.detail !== ONBOARDING_REQUIRED) {
    return i18n.t('proposals.errors.unaddressed');
  }
  return describeApiError(e);
}

/** A label for the required `session_id` that names no real session. See the module note. */
function sessionLabel(): string {
  return `gotg-suggestions-${bytesToHex(randomBytes(16))}`;
}

export interface UseProposals {
  data: { rows: ProposalRow[] };
  loading: boolean;
  /** Why the last read failed, when there is a sentence for it. */
  error: string | null;
  /** The first read failed and nothing has loaded, so an empty list says nothing. */
  failed: boolean;
  /** The id a decision is in flight for. */
  deciding: string | null;
  /** What the last decision came to: a confirmation or a refusal, for the screen to show. */
  outcome: { tone: 'success' | 'danger'; text: string } | null;
  actions: {
    refresh: () => Promise<void>;
    decide: (id: string, decision: ProposalDecision) => Promise<void>;
  };
}

export function useProposals(): UseProposals {
  const { hydrated } = useServer();
  const [session] = useState(sessionLabel);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<UseProposals['outcome']>(null);

  // Whether a read has ever succeeded. After one, a failed poll keeps what is on screen.
  const loaded = useRef(false);

  /** `loud` is a read somebody asked for; a poll is quiet and keeps the last good list. */
  const load = useCallback(
    async (loud: boolean) => {
      if (loud) {
        setLoading(true);
        setError(null);
      }
      try {
        setProposals(await api.listProposals(session));
        loaded.current = true;
        setError(null);
        setFailed(false);
      } catch (e) {
        if (loud || !loaded.current) setError(describeProposalError(e));
        else console.warn('[proposals] refresh failed; showing the last list', e instanceof ApiError ? e.status : 'network');
        if (!loaded.current) setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [session],
  );

  useLive(() => load(false), PROPOSALS_MS, hydrated);
  const refresh = useCallback(() => load(true), [load]);

  const decide = useCallback(
    async (id: string, decision: ProposalDecision) => {
      setDeciding(id);
      setOutcome(null);
      try {
        await api.decideProposal(id, session, decision);
        console.info('[proposals] decided', id, decision);
        setOutcome({
          tone: 'success',
          text: decision === 'approve' ? i18n.t('proposals.accepted') : i18n.t('proposals.declined'),
        });
      } catch (e) {
        console.warn('[proposals] decision failed', decision, e instanceof ApiError ? e.status : 'network');
        setOutcome({ tone: 'danger', text: decisionFailure(e) });
      } finally {
        setDeciding(null);
      }
      await load(true);
    },
    [load, session],
  );

  const rows = proposals.map((p) => toProposalRow(p, i18n.language));

  return { data: { rows }, loading, error, failed, deciding, outcome, actions: { refresh, decide } };
}

/** A decision always says something when it fails; the list refresh then shows what is left. */
function decisionFailure(e: unknown): string {
  if (e instanceof ApiError && e.status === 404) return i18n.t('proposals.errors.gone');
  if (e instanceof ApiError && e.status === 409) return i18n.t('proposals.errors.conflict');
  return describeProposalError(e) ?? i18n.t('proposals.errors.decideFailed');
}
