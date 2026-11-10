/**
 * Search across the stories Goose wrote, the ones the member read, and their saved cards, on the
 * phone: every word, in any order, in a headline, a line under it, a topic or a title.
 */

import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkSearchField, InkText, useInkTheme } from '@jarida/ink/native';

import { GroupRow, InsetGroup } from '@/components/goose/following';
import { ScreenScroll, SectionHead } from '@/components/goose/hub-parts';
import { StoryRow } from '@/components/goose/news-cards';
import { Spacing } from '@/constants/spacing';
import type { Story } from '@/models/news';
import { useNews, useNewsHistory } from '@/view-models/use-news';
import { useSavedItems } from '@/view-models/use-saved-items';

function matches(words: string[], ...fields: (string | null | undefined)[]): boolean {
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

export default function GooseSearchScreen() {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const news = useNews();
  const history = useNewsHistory();
  const saved = useSavedItems();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);

  const stories = useMemo(() => {
    const seen = new Map<string, Story>();
    for (const s of [...news.data.stories, ...history.data]) if (!seen.has(s.id)) seen.set(s.id, s);
    return [...seen.values()];
  }, [news.data.stories, history.data]);
  const foundStories = words.length ? stories.filter((s) => matches(words, s.headline, s.dek, s.interest?.topic, s.source.name)) : [];
  const foundSaved = words.length ? saved.data.items.filter((i) => matches(words, i.title, i.body, i.collection)) : [];

  return (
    <ScreenScroll gap={Spacing.xl}>
      <InkSearchField value={query} onChange={setQuery} label={t('goose.search.title')} placeholder={t('goose.search.placeholder')} />
      {words.length && foundStories.length + foundSaved.length === 0 ? (
        <InkText tone="secondary">{t('goose.search.none', { query: query.trim() })}</InkText>
      ) : null}
      {!words.length ? <InkText tone="secondary">{t('goose.search.hint')}</InkText> : null}
      {foundStories.length ? (
        <View style={styles.section}>
          <SectionHead title={t('goose.search.stories')} size="small" />
          <View>
            {foundStories.map((s, i) => (
              <View key={s.id} style={i > 0 ? [styles.divided, { borderTopColor: theme.color.line }] : null}>
                <StoryRow story={s} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {foundSaved.length ? (
        <View style={styles.section}>
          <SectionHead title={t('goose.search.saved')} size="small" />
          <InsetGroup>
            {foundSaved.map((item, i) => (
              <GroupRow
                key={item.id}
                first={i === 0}
                icon="archive"
                label={item.title}
                detail={item.collection}
                onPress={() => router.push({ pathname: '/(stack)/saved-item', params: { id: item.id } })}
              />
            ))}
          </InsetGroup>
        </View>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.sm },
  divided: { borderTopWidth: StyleSheet.hairlineWidth },
});
