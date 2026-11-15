/**
 * One section of the news, such as Tech or Cars: the member's interests of that kind, then their
 * stories, newest first.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkEmptyState, InkSpinner, InkText, useInkTheme } from '@/components/ui/ink';

import { GroupRow, InsetGroup } from '@/components/goose/following';
import { ScreenScroll, SectionHead, useAgo } from '@/components/goose/hub-parts';
import { HeroStory, StoryRow, openInterest } from '@/components/goose/news-cards';
import { Spacing } from '@/constants/spacing';
import { CATEGORIES, categoryKey, initialOf, type InterestCategory } from '@/models/interests';
import { useInterests } from '@/view-models/use-interests';
import { useNews, useStoryActions } from '@/view-models/use-news';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

export default function GooseSectionScreen() {
  const params = useLocalSearchParams<{ category: string }>();
  const category = CATEGORIES.find((c) => c === params.category) ?? ('other' as InterestCategory);
  const theme = useInkTheme();
  const { t } = useTranslation();
  const ago = useAgo();
  const news = useNews();
  const interests = useInterests();
  const actions = useStoryActions();
  const pull = usePullToRefresh(async () => {
    await Promise.all([news.reload(), interests.reload()]);
  });
  const mine = interests.groups.confirmed.filter((i) => i.category === category);
  const ids = useMemo(() => new Set(mine.map((i) => i.id)), [mine]);
  const stories = news.data.stories
    .filter((s) => s.interest?.category === category || (s.interest && ids.has(s.interest.id)))
    .sort((a, b) => (b.publishedAt ?? b.writtenAt ?? '').localeCompare(a.publishedAt ?? a.writtenAt ?? ''));
  const [hero, ...rest] = stories;

  return (
    <ScreenScroll pull={pull}>
      <SectionHead title={t(categoryKey(category))} subtitle={t('goose.section.subtitle')} />
      {mine.length ? (
        <InsetGroup>
          {mine.map((i, n) => (
            <GroupRow key={i.id} first={n === 0} picture={i.picture} initial={initialOf(i.topic)} label={i.topic} detail={i.facets.join(', ') || null} onPress={() => openInterest(i.id)} />
          ))}
        </InsetGroup>
      ) : null}
      {news.loading ? <InkSpinner label={t('goose.news.loading')} /> : null}
      {!news.loading && stories.length === 0 ? (
        <InkEmptyState icon="news" title={t('goose.section.emptyTitle')}>
          <InkText tone="secondary">{t('goose.section.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}
      {hero ? <HeroStory story={hero} actions={actions} followed={null} /> : null}
      {rest.length ? (
        <View>
          {rest.map((s, i) => (
            <View key={s.id} style={i > 0 ? [styles.divided, { borderTopColor: theme.color.line }] : null}>
              <StoryRow story={s} meta={[s.source.name, ago(s.publishedAt ?? s.writtenAt)].filter(Boolean).join(', ')} />
            </View>
          ))}
        </View>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({ divided: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.xs } });
