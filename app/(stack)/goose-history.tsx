/**
 * History: the stories the member opened in the last thirty days, most recent first.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkEmptyState, InkSpinner, InkText, useInkTheme } from '@jarida/ink/native';

import { ScreenScroll, SectionHead, useAgo } from '@/components/goose/hub-parts';
import { StoryRow } from '@/components/goose/news-cards';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { useNewsHistory } from '@/view-models/use-news';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

export default function GooseHistoryScreen() {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const ago = useAgo();
  const history = useNewsHistory();
  const pull = usePullToRefresh(history.reload);
  const state = useContentState({ loading: history.loading, failed: history.failed, hasContent: history.data.length > 0 });
  return (
    <ScreenScroll pull={pull}>
      <SectionHead title={t('goose.history.title')} subtitle={t('goose.history.subtitle')} />
      {state === 'loading' ? <InkSpinner label={t('goose.history.loading')} /> : null}
      {isUnavailable(state) ? <ContentUnavailable state={state} reason={history.error} onRetry={history.reload} /> : null}
      {state === 'empty' ? (
        <InkEmptyState icon="schedule" title={t('goose.history.emptyTitle')}>
          <InkText tone="secondary">{t('goose.history.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}
      <View>
        {history.data.map((s, i) => (
          <View key={s.id} style={i > 0 ? [styles.divided, { borderTopColor: theme.color.line }] : null}>
            <StoryRow story={s} meta={[s.source.name, s.readAt ? t('goose.history.read', { when: ago(s.readAt) }) : null].filter(Boolean).join(', ')} />
          </View>
        ))}
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({ divided: { borderTopWidth: StyleSheet.hairlineWidth } });
