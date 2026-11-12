// What Goose did for this member on its own: the member reads the list, takes back what can be
// taken back, and opening it marks it read (pond docs/architecture/my-goose-hub.md, part 0c).

import { useCallback, useEffect, useRef } from 'react';

import { EMPTY_ACTIVITY, type GooseActivity, type GooseActivityList } from '@/models/goose-activity';
import { api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import { hubAction, useHubRead } from './hub-read';

export const ACTIVITY_MS = 2 * 60_000;

export function useGooseActivity(enabled = true) {
  const activity = useHubRead<GooseActivityList>('goose-activity', () => api.gooseActivity(), EMPTY_ACTIVITY, ACTIVITY_MS, enabled);
  const { data, setData } = activity;
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
  });

  const undo = useCallback(
    async (entry: GooseActivity) => {
      const before = latest.current.items.find((item) => item.id === entry.id);
      if (!before || !before.canUndo) return;
      const mark = (item: GooseActivity, undone: boolean): GooseActivity => ({ ...item, undone, canUndo: !undone });
      setData((d) => ({ ...d, items: d.items.map((item) => (item.id === entry.id ? mark(item, true) : item)) }));
      const done = await hubAction('goose-activity', () => api.undoGooseActivity(entry.id).then(() => true));
      if (!done) {
        setData((d) => ({ ...d, items: d.items.map((item) => (item.id === entry.id ? mark(item, false) : item)) }));
        return;
      }
      showSnackbar({ message: i18n.t('goose.activity.undoneNow'), tone: 'success' });
    },
    [setData],
  );

  /** The member has looked: nothing is new any more. A failed mark only leaves the count up. */
  const markSeen = useCallback(async () => {
    if (latest.current.unseen === 0) return;
    setData((d) => ({ ...d, unseen: 0 }));
    await api.markGooseActivitySeen().catch(() => undefined);
  }, [setData]);

  return { ...activity, actions: { reload: activity.reload, undo, markSeen } };
}

export type UseGooseActivity = ReturnType<typeof useGooseActivity>;
