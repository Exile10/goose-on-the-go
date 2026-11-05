/**
 * What the Pond has thought of, gathered for Home: suggestions waiting on a yes or no, questions
 * worth asking, an agent it could run, and the reminders it lifted out of conversations.
 *
 * All four already exist, each on its own screen behind the You tab. The screen reads this once
 * and hands the parts down: a second `useProposals` would mint a second session label and double
 * every poll, and the two copies would disagree for a minute after every decision.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { Storage } from '@/services/storage';
import type { AgentSuggestion } from '@/services/types';
import { useAgentsSource } from './agents-source';
import { useLive } from './use-live';
import { useProposals, type ProposalRow } from './use-proposals';
import { useReminders, type ReminderRow } from './use-reminders';
import { useSuggestions, type OfferedPrompt } from './use-suggestions';

/** What the Pond can run changes with its devices and extensions, not from minute to minute. */
export const AGENT_IDEAS_MS = 10 * 60_000;


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
    /** Every suggestion the Pond offers, for the board's From your Pond widget, which grows to hold them. */
    proposals: ProposalRow[];
    /** What a new chat offers to ask, the same list: the Pond's own questions, or the starters. */
    prompts: OfferedPrompt[];
    agent: AgentIdea | null;
    reminders: HomeReminders | null;
    /** Pending reminders, for the sentence Home leads with when nothing is proposed. */
    reminderCount: number;
  };
  deciding: string | null;
  /**
   * Both reads that ask something of the reader answered, and neither had anything. A read that
   * failed is not quiet: it is unknown, and Home says nothing rather than "nothing needs you".
   */
  quiet: boolean;
  /** From your Pond folded to its first suggestion. A preference of this phone, kept across launches. */
  collapsed: boolean;
  actions: {
    approve: (id: string) => Promise<void>;
    decline: (id: string) => Promise<void>;
    taken: (prompt: OfferedPrompt) => void;
    toggleCollapsed: () => void;
  };
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
  const proposals = useProposals();
  const reminders = useReminders();
  // Asked as a new chat asks, with no conversation, so Ask Goose offers what the chat would.
  const suggestions = useSuggestions(null);
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

  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    let live = true;
    void Storage.get('homeIdeasCollapsed')
      .then((stored) => {
        if (live && stored === '1') setCollapsed(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  // A convenience, not a record: a write that fails costs the next launch the fold and nothing else.
  const toggleCollapsed = useCallback(() => {
    setCollapsed(!collapsed);
    void Storage.set('homeIdeasCollapsed', collapsed ? '0' : '1').catch(() => undefined);
  }, [collapsed]);

  const prompts = suggestions.data.prompts;

  // On the functions, not on the `actions` objects around them: both hooks build a fresh literal
  // every render, so depending on those would rebuild this every render and memoise nothing.
  const { decide } = proposals.actions;
  const { taken } = suggestions.actions;
  const actions = useMemo(
    () => ({
      approve: (id: string) => decide(id, 'approve'),
      decline: (id: string) => decide(id, 'reject'),
      taken,
      toggleCollapsed,
    }),
    [decide, taken, toggleCollapsed],
  );

  const rows = proposals.data.rows;
  const pending = reminders.data.rows;
  const settled = (r: { loading: boolean; failed: boolean; error: string | null }) => !r.loading && !r.failed && !r.error;

  return {
    data: {
      proposals: rows,
      prompts,
      agent,
      reminders: pending.length > 0 ? { first: pending[0], more: pending.length - 1 } : null,
      reminderCount: pending.length,
    },
    deciding: proposals.deciding,
    quiet: settled(proposals) && settled(reminders) && rows.length === 0 && pending.length === 0,
    collapsed,
    actions,
  };
}
