// What Goose knows the member is into: confirmed interests in the member's own order, guesses to
// confirm or dismiss, and the edits a member makes to one (docs/MY-GOOSE-HUB.md, part 1).

import { useCallback, useEffect, useMemo, useState } from 'react';

import { inMemberOrder, interestWrite, sortInterests, type Interest, type Portrait } from '@/models/interests';
import { useServer } from '@/providers/server-provider';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import { Storage } from '@/services/storage';
import type { InterestWriteWire } from '@/services/types';
import { hubAction, useHubRead } from './hub-read';

export const INTERESTS_MS = 10 * 60_000;

export type InterestEdit = Parameters<typeof interestWrite>[0];

export function useInterests(enabled = true) {
  const list = useHubRead<Interest[]>('interests', (s) => s.interests(), [], INTERESTS_MS, enabled);
  const portrait = useHubRead<Portrait | null>('portrait', (s) => s.portrait(), null, 30 * 60_000, enabled);
  const { source, setData, data } = list;
  const { hydrated } = useServer();
  const [order, setOrder] = useState<string[]>([]);

  useEffect(() => {
    if (!hydrated) return;
    void Storage.getJSON<string[]>('interestOrder').then((saved) => setOrder(Array.isArray(saved) ? saved : []));
  }, [hydrated]);

  const groups = useMemo(() => {
    const sorted = sortInterests(data);
    return { ...sorted, confirmed: inMemberOrder(sorted.confirmed, order) };
  }, [data, order]);

  const put = useCallback((interest: Interest) => setData((all) => (all.some((i) => i.id === interest.id) ? all.map((i) => (i.id === interest.id ? interest : i)) : [interest, ...all])), [setData]);

  const send = useCallback(
    async (id: string, body: InterestWriteWire, said?: string) => {
      const done = await hubAction('interests', () => source.editInterest(id, body));
      if (!done) return null;
      put(done);
      if (said) showSnackbar({ message: said, tone: 'success' });
      return done;
    },
    [put, source],
  );

  const edit = useCallback((id: string, change: InterestEdit) => send(id, interestWrite(change), i18n.t('goose.interests.saved')), [send]);
  const confirmGuess = useCallback((interest: Interest) => send(interest.id, { confirmed: true }, i18n.t('goose.interests.confirmed', { topic: interest.topic })), [send]);
  const setFollowing = useCallback(
    (interest: Interest, on: boolean) =>
      send(interest.id, { news: on ? 'tiles' : 'off' }, i18n.t(on ? 'goose.story.following' : 'goose.story.unfollowed', { topic: interest.topic })),
    [send],
  );
  const never = useCallback((interest: Interest) => send(interest.id, { avoid: true }, i18n.t('goose.story.neverShown', { topic: interest.topic })), [send]);
  const allowAgain = useCallback((interest: Interest) => send(interest.id, { avoid: false }, i18n.t('goose.interests.allowed', { topic: interest.topic })), [send]);

  const add = useCallback(
    async (change: InterestEdit & { topic: string }) => {
      const body = interestWrite(change);
      const done = await hubAction('interests', () => source.addInterest({ ...body, topic: change.topic.trim() }));
      if (!done) return null;
      put(done);
      showSnackbar({ message: i18n.t('goose.interests.added', { topic: done.topic }), tone: 'success' });
      return done;
    },
    [put, source],
  );

  /** Removing an interest, or dismissing a guess: the row goes, and evidence may bring a guess back later. */
  const remove = useCallback(
    async (interest: Interest) => {
      setData((all) => all.filter((i) => i.id !== interest.id));
      const done = await hubAction('interests', () => source.deleteInterest(interest.id));
      if (done === null) put(interest);
      else showSnackbar({ message: i18n.t('goose.interests.removed', { topic: interest.topic }), tone: 'success' });
    },
    [put, setData, source],
  );

  /** Moves an interest up or down the member's own order, which the phone keeps. */
  const move = useCallback(
    (id: string, by: -1 | 1) => {
      const ids = groups.confirmed.map((i) => i.id);
      const at = ids.indexOf(id);
      const to = at + by;
      if (at < 0 || to < 0 || to >= ids.length) return;
      [ids[at], ids[to]] = [ids[to], ids[at]];
      setOrder(ids);
      void Storage.setJSON('interestOrder', ids);
    },
    [groups.confirmed],
  );

  return {
    ...list,
    groups,
    portrait: portrait.data,
    actions: {
      reload: async () => {
        await Promise.all([list.reload(), portrait.reload()]);
      },
      edit,
      add,
      confirmGuess,
      setFollowing,
      never,
      allowAgain,
      remove,
      move,
    },
  };
}

export type UseInterests = ReturnType<typeof useInterests>;
