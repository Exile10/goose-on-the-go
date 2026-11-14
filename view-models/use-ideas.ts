// Ideas Goose researched for the member: Goose takes its part, or the member's steps become to-dos
// (docs/MY-GOOSE-HUB.md, part 6).

import { useCallback, useState } from 'react';

import type { Idea } from '@/models/ideas';
import type { Todo } from '@/models/todos';
import { confirm } from '@/services/haptics';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import { hubAction, useHubRead } from './hub-read';

/** While Goose is thinking of ideas, a read every few seconds; while it works on one, every half minute. */
export const IDEAS_THINKING_MS = 5_000;
export const IDEAS_WORKING_MS = 30_000;
export const IDEAS_MS = 15 * 60_000;

type IdeasData = { ideas: Idea[]; state: 'idle' | 'thinking' };

export function useIdeas(enabled = true) {
  const ideas = useHubRead<IdeasData>(
    'ideas',
    (s) => s.ideas(),
    { ideas: [], state: 'idle' },
    (d) => (d.state === 'thinking' ? IDEAS_THINKING_MS : d.ideas.some((i) => i.state === 'working') ? IDEAS_WORKING_MS : IDEAS_MS),
    enabled,
  );
  const { source, setData } = ideas;
  const [busy, setBusy] = useState<string | null>(null);
  /** The to-dos an idea's steps became, by idea, so its card can show them. */
  const [made, setMade] = useState<Record<string, Todo[]>>({});

  const put = useCallback((idea: Idea) => setData((d) => ({ ...d, ideas: d.ideas.map((i) => (i.id === idea.id ? idea : i)) })), [setData]);

  const gooseDoIt = useCallback(
    async (idea: Idea) => {
      setBusy(idea.id);
      const done = await hubAction('ideas', () => source.ideaGoose(idea.id), { retry: true });
      setBusy(null);
      if (!done) return;
      put(done);
      void confirm();
      showSnackbar({ message: i18n.t('goose.ideas.gooseStarted'), tone: 'success' });
    },
    [put, source],
  );

  const illDoIt = useCallback(
    async (idea: Idea) => {
      setBusy(idea.id);
      const done = await hubAction('ideas', () => source.ideaMine(idea.id));
      setBusy(null);
      if (!done) return;
      put(done.idea);
      setMade((m) => ({ ...m, [idea.id]: done.todos }));
      void confirm();
      showSnackbar({ message: i18n.t('goose.ideas.stepsAdded', { count: done.todos.length }), tone: 'success' });
    },
    [put, source],
  );

  const dismiss = useCallback(
    async (idea: Idea) => {
      put({ ...idea, state: 'dismissed' });
      const done = await hubAction('ideas', () => source.dismissIdea(idea.id));
      if (done === null) put(idea);
    },
    [put, source],
  );

  const thinkAgain = useCallback(async () => {
    const done = await hubAction('ideas', () => source.refreshIdeas(), { retry: true });
    if (done === null) return;
    setData((d) => ({ ...d, state: 'thinking' }));
  }, [setData, source]);

  return { ...ideas, busy, made, actions: { reload: ideas.reload, gooseDoIt, illDoIt, dismiss, thinkAgain } };
}

export type UseIdeas = ReturnType<typeof useIdeas>;

/** One idea by id, from the member's ideas, with the actions its page offers. */
export function useIdea(id: string | undefined) {
  const ideas = useIdeas();
  const idea = id ? (ideas.data.ideas.find((i) => i.id === id) ?? null) : null;
  return { idea, ideas };
}
