/**
 * Goose's notes: what it has learned about working for the member, and what it is keeping an eye
 * on. The member reads them and deletes any; only Goose writes them.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { InkEmptyState, InkSpinner, InkText } from '@jarida/ink/native';

import { ListSection, SentenceRow } from '@/components/goose/about-parts';
import { InsetGroup } from '@/components/goose/following';
import { RoundButton, ScreenScroll } from '@/components/goose/hub-parts';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { Spacing } from '@/constants/spacing';
import { isUnavailable } from '@/models/content-state';
import type { GooseNote } from '@/models/goose-notes';
import { useContentState } from '@/view-models/use-content-state';
import { useGooseNotes } from '@/view-models/use-goose-notes';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

export default function GooseNotesScreen() {
  const { t } = useTranslation();
  const notes = useGooseNotes();
  const pull = usePullToRefresh(notes.actions.reload);
  const { lessons, notes: followUps } = notes.data;
  const state = useContentState({ loading: notes.loading, failed: notes.failed, hasContent: lessons.length + followUps.length > 0 });

  const rows = (list: GooseNote[]) => (
    <InsetGroup>
      {list.map((note, i) => (
        <SentenceRow
          key={note.id}
          first={i === 0}
          text={note.text}
          detail={note.shared ? t('goose.notes.shared') : null}
          trailing={<RoundButton icon="trash" size={30} label={t('goose.notes.delete')} onPress={() => void notes.actions.remove(note)} />}
        />
      ))}
    </InsetGroup>
  );

  return (
    <ScreenScroll pull={pull} gap={Spacing.xl}>
      <InkText tone="secondary">{t('goose.notes.lead')}</InkText>
      {state === 'loading' ? <InkSpinner label={t('goose.notes.loading')} /> : null}
      {isUnavailable(state) ? <ContentUnavailable state={state} reason={notes.error} onRetry={notes.actions.reload} /> : null}
      {state === 'empty' ? (
        <InkEmptyState icon="file-text" title={t('goose.notes.emptyTitle')}>
          <InkText tone="secondary">{t('goose.notes.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}
      {lessons.length ? <ListSection title={t('goose.notes.lessons')}>{rows(lessons)}</ListSection> : null}
      {followUps.length ? <ListSection title={t('goose.notes.followUps')}>{rows(followUps)}</ListSection> : null}
    </ScreenScroll>
  );
}
