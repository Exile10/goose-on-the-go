/**
 * What the Pond has thought of, gathered for Home: suggestions waiting on a yes or no, questions
 * worth asking, an agent it could run, and the reminders it lifted out of conversations.
 *
 * All four already exist, each on its own screen behind the You tab. The screen reads this once
 * and hands the parts down: a second `useProposals` would mint a second session label and double
 * every poll, and the two copies would disagree for a minute after every decision.
 */

import { bytesToHex } from '@noble/hashes/utils.js';
import { useMemo, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { randomBytes } from '@/services/secure-random';
import type { AgentSuggestion } from '@/services/types';
import { useAgentsSource } from './agents-source';
import { useLive } from './use-live';
import { useProposals, type ProposalRow } from './use-proposals';
import { useReminders, type ReminderRow } from './use-reminders';
import { useSuggestions, type OfferedPrompt } from './use-suggestions';

/**
 * One decision at a time. Two cards took most of a phone's first screen and pushed the facts below
 * the fold; the rest wait one tap away, on the screen that lists them.
 */
export const HOME_PROPOSAL_LIMIT = 1;

/** Three chips is one or two lines on a phone; more and the row becomes a paragraph. */
export const HOME_PROMPT_LIMIT = 3;

/** What the Pond can run changes with its devices and extensions, not from minute to minute. */
export const AGENT_IDEAS_MS = 10 * 60_000;

/** A prompt the Pond offered. A fixed starter carries no id, and is not an idea from the Pond. */
export type PondPrompt = OfferedPrompt & { id: string };

/** One agent the Pond could run, as Home names it. */
export interface AgentIdea {
  template: string;
  title: string;
  /** When it would run, in the Pond's words: "When you come home". */
  when: string;
}

export interface HomeReminders {
  first: ReminderRow;
  /** How many wait behind the one named. */
  more: number;
}

export interface UseHomeIdeas {
  data: {
    proposals: ProposalRow[];
    /** How many are offered beyond the ones on Home, for the link to the rest. */
    moreProposals: number;
    prompts: PondPrompt[];
    agent: AgentIdea | null;
    reminders: HomeReminders | null;
  };
  deciding: string | null;
  /**
   * Both reads that ask something of the reader answered, and neither had anything. A read that
   * failed is not quiet: it is unknown, and Home says nothing rather than "nothing needs you".
   */
  quiet: boolean;
  actions: {
    approve: (id: string) => Promise<void>;
    decline: (id: string) => Promise<void>;
    taken: (prompt: OfferedPrompt) => void;
  };
}

/**
 * A label for the required `session_id` that names no real session. Borrowing one from the recent
 * list would quietly claim it: the Pond binds an unattributed session to the device's member on read.
 */
function homeSessionLabel(): string {
  return `gotg-home-${bytesToHex(randomBytes(16))}`;
}

export function toAgentIdea(suggestion: AgentSuggestion): AgentIdea {
  return {
    template: suggestion.template,
    title: suggestion.title.trim(),
    when: suggestion.activations_summary.trim(),
  };
}

export function useHomeIdeas(): UseHomeIdeas {
  const { hydrated } = useServer();
  const [session] = useState(homeSessionLabel);
  const proposals = useProposals();
  const reminders = useReminders();
  const suggestions = useSuggestions(session);
  const agents = useAgentsSource();

  const [agent, setAgent] = useState<AgentIdea | null>(null);
  useLive(
    async () => {
      try {
        const offered = await agents.listSuggestions();
        setAgent(offered.length > 0 ? toAgentIdea(offered[0]) : null);
      } catch {
        // An offer, not Home's subject: a Pond without the route, or one that failed, offers none.
      }
    },
    AGENT_IDEAS_MS,
    hydrated,
  );

  const prompts = useMemo(
    () => suggestions.data.prompts.filter((p): p is PondPrompt => p.id !== null).slice(0, HOME_PROMPT_LIMIT),
    [suggestions.data.prompts],
  );

  // On the functions, not on the `actions` objects around them: both hooks build a fresh literal
  // every render, so depending on those would rebuild this every render and memoise nothing.
  const { decide } = proposals.actions;
  const { taken } = suggestions.actions;
  const actions = useMemo(
    () => ({
      approve: (id: string) => decide(id, 'approve'),
      decline: (id: string) => decide(id, 'reject'),
      taken,
    }),
    [decide, taken],
  );

  const rows = proposals.data.rows;
  const pending = reminders.data.rows;
  const settled = (r: { loading: boolean; failed: boolean; error: string | null }) => !r.loading && !r.failed && !r.error;

  return {
    data: {
      proposals: rows.slice(0, HOME_PROPOSAL_LIMIT),
      moreProposals: Math.max(0, rows.length - HOME_PROPOSAL_LIMIT),
      prompts,
      agent,
      reminders: pending.length > 0 ? { first: pending[0], more: pending.length - 1 } : null,
    },
    deciding: proposals.deciding,
    quiet: settled(proposals) && settled(reminders) && rows.length === 0 && pending.length === 0,
    actions,
  };
}
