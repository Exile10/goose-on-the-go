/**
 * What Goose did for the member without being asked: reminders it set, notes it wrote itself, a
 * failing watch it paused, things it looked up, a phone it removed. The member reads it and takes
 * back what can be taken back; opening the screen marks it read.
 */

import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { InkEmptyState, InkSpinner, InkText } from '@/components/ui/ink';

import { ListSection, SentenceRow } from '@/components/goose/about-parts';
import { InsetGroup } from '@/components/goose/following';
import { RoundButton, ScreenScroll, useAgo } from '@/components/goose/hub-parts';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { Spacing } from '@/constants/spacing';
import { isUnavailable } from '@/models/content-state';
import { activityIcon, type ActivityKind, type GooseActivity } from '@/models/goose-activity';
import { useConfirm } from '@/providers/confirm-provider';
import { useContentState } from '@/view-models/use-content-state';
import { useGooseActivity } from '@/view-models/use-goose-activity';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

function isToday(iso: string | null): boolean {
  return iso !== null && new Date(iso).toDateString() === new Date().toDateString();
}

export default function GooseActivityScreen() {
  const { t } = useTranslation();
  const ago = useAgo();
  const ask = useConfirm();
  const activity = useGooseActivity();
  const pull = usePullToRefresh(activity.actions.reload);
  const { items } = activity.data;
  const state = useContentState({ loading: activity.loading, failed: activity.failed, hasContent: items.length > 0 });
  const { markSeen } = activity.actions;

  useEffect(() => {
    if (state === 'ready') void markSeen();
  }, [state, markSeen]);

  const kindLabel = (kind: ActivityKind): string => {
    switch (kind) {
      case 'reminder':
        return t('goose.activity.kind.reminder');
      case 'note':
        return t('goose.activity.kind.note');
      case 'note_closed':
        return t('goose.activity.kind.note_closed');
      case 'watch_paused':
        return t('goose.activity.kind.watch_paused');
      case 'suggestion':
        return t('goose.activity.kind.suggestion');
      case 'errand':
        return t('goose.activity.kind.errand');
      case 'phone_removed':
        return t('goose.activity.kind.phone_removed');
    }
  };

  const undoWords = (kind: ActivityKind): string => {
    switch (kind) {
      case 'reminder':
        return t('goose.activity.undoConfirmReminder');
      case 'watch_paused':
        return t('goose.activity.undoConfirmWatch');
      default:
        return t('goose.activity.undoConfirmNote');
    }
  };

  const undo = async (entry: GooseActivity) => {
    const yes = await ask({
      title: t('goose.activity.undoConfirmTitle'),
      message: undoWords(entry.kind),
      confirmLabel: t('goose.activity.undo'),
    });
    if (yes) await activity.actions.undo(entry);
  };

  const rows = (list: GooseActivity[]) => (
    <InsetGroup>
      {list.map((entry, i) => {
        const when = ago(entry.at);
        const meta = [kindLabel(entry.kind), when, entry.undone ? t('goose.activity.undone') : null].filter(Boolean).join(' · ');
        return (
          <SentenceRow
            key={entry.id}
            first={i === 0}
            icon={activityIcon(entry.kind)}
            text={entry.summary}
            detail={entry.detail ? `${entry.detail}\n${meta}` : meta}
            detailLines={entry.detail ? 12 : 1}
            trailing={
              entry.canUndo ? <RoundButton icon="restore" size={30} label={t('goose.activity.undo')} onPress={() => void undo(entry)} /> : undefined
            }
          />
        );
      })}
    </InsetGroup>
  );

  const today = items.filter((entry) => isToday(entry.at));
  const earlier = items.filter((entry) => !isToday(entry.at));

  return (
    <ScreenScroll pull={pull} gap={Spacing.xl}>
      <InkText tone="secondary">{t('goose.activity.lead')}</InkText>
      {state === 'loading' ? <InkSpinner label={t('goose.activity.loading')} /> : null}
      {isUnavailable(state) ? <ContentUnavailable state={state} reason={activity.error} onRetry={activity.actions.reload} /> : null}
      {state === 'empty' ? (
        <InkEmptyState icon="activity" title={t('goose.activity.emptyTitle')}>
          <InkText tone="secondary">{t('goose.activity.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}
      {today.length ? <ListSection title={t('goose.activity.today')}>{rows(today)}</ListSection> : null}
      {earlier.length ? <ListSection title={t('goose.activity.earlier')}>{rows(earlier)}</ListSection> : null}
    </ScreenScroll>
  );
}
