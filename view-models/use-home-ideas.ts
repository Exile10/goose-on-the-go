/**
 * What the Pond has thought of, for Home: proposals awaiting a yes or no, prompts worth asking,
 * and how many reminders are still pending.
 *
 * Three sources the Pond already composes, none of which Home showed. They are gathered here
 * rather than in the screen because a screen renders and a view-model fetches, and because the
 * session rule below is the kind of thing that must live in one place.
 *
 * **The session label names no session.** `GET /suggestions` keys off a session id to decide
 * whose data it may read, and Home has no conversation open. Borrowing one from the recent list
 * would be wrong rather than merely untidy: the Pond binds an unattributed session to the
 * device's member on read, so Home would quietly claim somebody else's conversation. So Home
 * mints its own label, once per visit, exactly as `useProposals` does for the same reason.
 */

import { useMemo, useState } from 'react';

import { bytesToHex } from '@noble/hashes/utils.js';

import { randomBytes } from '@/services/secure-random';
import { useProposals, type ProposalRow } from './use-proposals';
import { useReminders } from './use-reminders';
import { useSuggestions, type OfferedPrompt } from './use-suggestions';

/** A prompt the Pond itself offered: it carries the Pond's id, where a fixed starter carries none. */
export type PondPrompt = OfferedPrompt & { id: string };

/** How many proposals Home shows before it stops and offers the rest behind See all. */
export const HOME_PROPOSAL_LIMIT = 2;

/** How many chips fit a phone without the row becoming a paragraph. */
export const HOME_PROMPT_LIMIT = 3;

/** A label for the required `session_id` that names no real session. See the module note. */
function homeSessionLabel(): string {
  return `gotg-home-${bytesToHex(randomBytes(16))}`;
}

export interface UseHomeIdeas {
  data: {
    /** At most `HOME_PROPOSAL_LIMIT`, newest first as the Pond ordered them. */
    proposals: ProposalRow[];
    /** How many the Pond is offering in all, so See all can say so. */
    proposalCount: number;
    prompts: PondPrompt[];
    /** Pending reminders, for the one line that leads to them. */
    reminderCount: number;
  };
  /** The id a decision is in flight for, so its card can show it. */
  deciding: string | null;
  /**
   * Nothing to draw: no proposals, no prompts, no reminders.
   *
   * A read that failed is empty here too, and Home draws nothing rather than an error. The
   * section is a glance at what the Pond thought of; the connection banner already says when the
   * Pond cannot be reached, and a second complaint under it would be the noise #196 removed.
   */
  empty: boolean;
  actions: {
    approve: (id: string) => Promise<void>;
    decline: (id: string) => Promise<void>;
    taken: (prompt: OfferedPrompt) => void;
    refresh: () => Promise<void>;
  };
}

export function useHomeIdeas(): UseHomeIdeas {
  const [session] = useState(homeSessionLabel);
  const proposals = useProposals();
  const reminders = useReminders();
  const suggestions = useSuggestions(session);

  const rows = proposals.data.rows;
  const shown = useMemo(() => rows.slice(0, HOME_PROPOSAL_LIMIT), [rows]);
  // Only what the Pond itself offered. `useSuggestions` keeps the fixed starters on screen when
  // the Pond has none, which is right in a conversation about to be started and wrong here: the
  // same three chips every day under "Ideas from your Pond" would be chrome, and would stop this
  // section ever being absent. A starter carries no id; anything the Pond composed or templated
  // does.
  const prompts = useMemo(
    () => suggestions.data.prompts.filter((p): p is PondPrompt => p.id !== null).slice(0, HOME_PROMPT_LIMIT),
    [suggestions.data.prompts],
  );

  // On the functions, not on the `actions` objects around them: both hooks build a fresh literal
  // every render, so depending on those would rebuild this every render and memoise nothing.
  const { decide, refresh } = proposals.actions;
  const { taken } = suggestions.actions;
  const actions = useMemo(
    () => ({
      approve: (id: string) => decide(id, 'approve'),
      decline: (id: string) => decide(id, 'reject'),
      taken,
      refresh,
    }),
    [decide, refresh, taken],
  );

  return {
    data: {
      proposals: shown,
      proposalCount: rows.length,
      prompts,
      reminderCount: reminders.data.rows.length,
    },
    deciding: proposals.deciding,
    empty: rows.length === 0 && prompts.length === 0 && reminders.data.rows.length === 0,
    actions,
  };
}
