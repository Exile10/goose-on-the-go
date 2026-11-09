/**
 * My Goose: everything the Goose is holding for this member, read once and handed to the tab's
 * shelves. Each part already has its own route on the Pond; nothing here invents one.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { cartsFrom, formatPrice, gooseClauses, watchesWithHits } from '@/models/my-goose';
import { useServer } from '@/providers/server-provider';
import type { AgentSuggestion } from '@/services/types';
import { useAgentsSource } from './agents-source';
import { useBriefs } from './use-briefs';
import { AGENT_IDEAS_MS } from './use-home-ideas';
import { useLive } from './use-live';
import { useProposals } from './use-proposals';
import { useReminders } from './use-reminders';
import { useSavedItems } from './use-saved-items';
import { useSuggestions } from './use-suggestions';
import { useWebWatches } from './use-web-watches';

/** Agents the Pond could run for this household, and saying yes or no to one. */
export function useAgentIdeas() {
  const { hydrated } = useServer();
  const agents = useAgentsSource();
  const [ideas, setIdeas] = useState<AgentSuggestion[]>([]);
  const [enabling, setEnabling] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIdeas(await agents.listSuggestions());
    } catch {
      // An offer, not a record: a Pond without the route offers none.
    }
  }, [agents]);
  useLive(refresh, AGENT_IDEAS_MS, hydrated);

  const enable = useCallback(
    async (template: string) => {
      setEnabling(template);
      try {
        await agents.enableSuggestion(template);
        setIdeas((all) => all.filter((i) => i.template !== template));
      } finally {
        setEnabling(null);
      }
    },
    [agents],
  );
  const dismiss = useCallback(
    async (template: string) => {
      setIdeas((all) => all.filter((i) => i.template !== template));
      await agents.dismissSuggestion(template).catch(() => undefined);
    },
    [agents],
  );

  return { ideas, enabling, refresh, enable, dismiss };
}

export function useMyGoose() {
  const proposals = useProposals();
  // Asked as a new chat asks, so the questions offered here are the ones a chat would offer.
  const suggestions = useSuggestions(null);
  const watches = useWebWatches();
  const saved = useSavedItems();
  const briefs = useBriefs();
  const reminders = useReminders();
  const agentIdeas = useAgentIdeas();

  // Watches and saved cards read once on mount; a return to the tab is when a chat may have added one.
  const returned = useRef(false);
  const { refresh: refreshWatches } = watches.actions;
  const { refresh: refreshSaved } = saved.actions;
  useFocusEffect(
    useCallback(() => {
      if (!returned.current) {
        returned.current = true;
        return;
      }
      void refreshWatches();
      void refreshSaved();
    }, [refreshWatches, refreshSaved]),
  );

  const offers = proposals.data.rows;
  // Only what the Pond composed: the fixed starters belong in an empty chat, not on a shelf.
  const prompts = suggestions.data.prompts.filter((p) => p.id !== null);
  const carts = useMemo(() => cartsFrom(saved.data.items), [saved.data.items]);
  const hits = useMemo(() => watchesWithHits(watches.data.watches), [watches.data.watches]);
  const kept = carts.reduce((sum, c) => sum + c.lines.length, 0);
  const lowest = carts.map((c) => c.low).filter((p) => p !== null)[0] ?? null;
  const brief = briefs.data.briefs[0] ?? null;
  const ideas = prompts.length + agentIdeas.ideas.length;

  const clauses = gooseClauses({
    offers: offers.length,
    watchHits: hits,
    brief,
    reminders: reminders.data.rows.length,
    cart: kept > 0 ? { count: kept, low: lowest ? formatPrice(lowest) : null } : null,
    ideas,
  });

  const { refresh: refreshProposals, decide } = proposals.actions;
  const { refresh: refreshBriefs } = briefs.actions;
  const { refresh: refreshReminders } = reminders.actions;
  const { refresh: refreshAgentIdeas } = agentIdeas;
  const refresh = useCallback(async () => {
    await Promise.all([
      refreshProposals(),
      refreshWatches(),
      refreshSaved(),
      refreshBriefs(),
      refreshReminders(),
      refreshAgentIdeas(),
    ]);
  }, [refreshProposals, refreshWatches, refreshSaved, refreshBriefs, refreshReminders, refreshAgentIdeas]);

  const loading =
    (proposals.loading && offers.length === 0) ||
    (watches.loading && watches.data.watches.length === 0) ||
    (saved.loading && saved.data.items.length === 0);

  return {
    data: {
      clauses,
      offers,
      watches: watches.data.watches,
      hits,
      carts,
      kept,
      briefs: briefs.data.briefs,
      asking: briefs.data.asking,
      prompts,
      agentIdeas: agentIdeas.ideas,
      reminders: reminders.data.rows,
    },
    loading,
    /** Reads that failed, so an empty shelf there says nothing rather than "nothing". */
    failed: {
      offers: proposals.failed,
      watches: watches.error !== null && watches.data.watches.length === 0,
      cart: saved.error !== null && saved.data.items.length === 0,
      news: briefs.error !== null && briefs.data.briefs.length === 0,
    },
    deciding: proposals.deciding,
    startingNews: briefs.starting,
    enabling: agentIdeas.enabling,
    actions: {
      refresh,
      approve: (id: string) => decide(id, 'approve'),
      decline: (id: string) => decide(id, 'reject'),
      taken: suggestions.actions.taken,
      startMorningNews: briefs.actions.startMorningNews,
      runBriefNow: briefs.actions.runNow,
      enableAgent: agentIdeas.enable,
      dismissAgent: agentIdeas.dismiss,
    },
  };
}

export type UseMyGoose = ReturnType<typeof useMyGoose>;
