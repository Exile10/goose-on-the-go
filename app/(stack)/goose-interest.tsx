/**
 * One interest's page: its name set large, the angles Goose follows, then its top stories picked by
 * Goose with the lead as a hero, and the rest as a list. The floating pill follows or unfollows it
 * and holds its menu: edit, never show, remove.
 */

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InkEmptyState, InkMenu, InkSpinner, InkText, inkText, useInkTheme } from '@jarida/ink/native';

import { HubPicture } from '@/components/goose/hub-picture';
import { RoundButton, SectionHead, useAgo } from '@/components/goose/hub-parts';
import { InterestSheet } from '@/components/goose/interest-sheet';
import { HeroStory, StoryRow } from '@/components/goose/news-cards';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Spacing } from '@/constants/spacing';
import { categoryKey, depthKey, initialOf } from '@/models/interests';
import { splitStories } from '@/models/news';
import { useConfirm } from '@/providers/confirm-provider';
import { tap } from '@/services/haptics';
import { useInterests } from '@/view-models/use-interests';
import { useInterestNews, useStoryActions } from '@/view-models/use-news';

const AFTER_MENU_MS = 450;

export default function GooseInterestScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const theme = useInkTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const ask = useConfirm();
  const ago = useAgo();
  const interests = useInterests();
  const news = useInterestNews(id);
  const actions = useStoryActions();
  const [editing, setEditing] = useState(false);
  const interest = interests.data.find((i) => i.id === id) ?? null;
  const following = !!interest && interest.news !== 'off' && !interest.avoid;
  const { news: stories, longReads } = useMemo(() => splitStories(news.data.stories), [news.data.stories]);
  const [hero, ...rest] = stories;
  const more = [...rest, ...longReads];
  const title = inkText(theme, { role: 'display', size: '3xl', weight: 700, tracking: 'title', leading: 'tight', color: theme.color.text }).style;
  const topic = interest?.topic ?? news.data.stories[0]?.interest?.topic ?? '';

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 68, paddingBottom: insets.bottom + Spacing['3xl'], paddingHorizontal: Spacing.lg, gap: Spacing['2xl'] }} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          {interest ? (
            interest.picture ? (
              <HubPicture path={interest.picture} label={interest.topic} style={[styles.tile, { borderRadius: theme.radius.lg }]} />
            ) : (
              <View style={[styles.tile, styles.center, { borderRadius: theme.radius.lg, backgroundColor: theme.color.accentSoft }]}>
                <Text style={inkText(theme, { role: 'display', size: '2xl', weight: 700, color: theme.color.accentLine }).style}>{initialOf(interest.topic)}</Text>
              </View>
            )
          ) : null}
          <Text style={title} accessibilityRole="header">
            {topic}
          </Text>
          {interest ? (
            <InkText size="md" tone="secondary">
              {[t(categoryKey(interest.category)), t(depthKey(interest.depth)), interest.avoid ? t('goose.interests.avoided') : interest.news === 'off' ? t('goose.following.muted') : null].filter(Boolean).join(', ')}
            </InkText>
          ) : null}
          {interest?.facets.length ? (
            <View style={styles.facets}>
              {interest.facets.map((f) => (
                <View key={f} style={[styles.facet, { backgroundColor: theme.color.accentSofter, borderColor: theme.color.line }]}>
                  <InkText size="sm" weight="semibold">
                    {f}
                  </InkText>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <SectionHead
            fact={news.data.lastWrittenAt ? t('goose.news.updated', { when: ago(news.data.lastWrittenAt) }) : null}
            title={t('goose.interest.topStories')}
            subtitle={t('goose.interest.picked')}
          />
          {news.loading ? <InkSpinner label={t('goose.news.loading')} /> : null}
          {!news.loading && news.data.stories.length === 0 ? (
            <InkEmptyState icon="news" title={following ? t('goose.interest.noneYet') : t('goose.interest.notFollowing')}>
              <InkText tone="secondary">{following ? t('goose.interest.noneYetBody') : t('goose.interest.notFollowingBody')}</InkText>
            </InkEmptyState>
          ) : null}
          {hero ? <HeroStory story={hero} actions={actions} followed={following} /> : null}
        </View>

        {more.length ? (
          <View style={styles.section}>
            <SectionHead title={t('goose.interest.more')} size="small" />
            <View>
              {more.map((story, i) => (
                <View key={story.id} style={i > 0 ? [styles.divided, { borderTopColor: theme.color.line }] : null}>
                  <StoryRow story={story} meta={[story.source.name, ago(story.publishedAt ?? story.writtenAt)].filter(Boolean).join(', ')} />
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.topBar, { top: insets.top + Spacing.sm }]} pointerEvents="box-none">
        <RoundButton icon="chevron-left" size={40} label={t('common.back')} onPress={() => router.back()} />
        {interest ? (
          <View style={[styles.pill, { backgroundColor: theme.color.chrome, borderColor: theme.color.lineStrong }]}>
            <GPressable
              onPress={() => {
                void tap();
                void interests.actions.setFollowing(interest, !following);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: following }}
              accessibilityLabel={following ? t('goose.story.menu.unfollow', { topic: interest.topic }) : t('goose.story.menu.follow', { topic: interest.topic })}
              style={styles.pillButton}
            >
              <GIcon name={following ? 'check' : 'plus'} size={20} color={following ? theme.color.accentLine : theme.color.text} strokeWidth={2.5} />
            </GPressable>
            <InkMenu
              label={interest.topic}
              items={[
                { key: 'edit', label: t('goose.interests.edit'), icon: 'edit', onPress: () => setTimeout(() => setEditing(true), AFTER_MENU_MS) },
                interest.avoid
                  ? { key: 'allow', label: t('goose.interests.allowAgain'), icon: 'eye', onPress: () => void interests.actions.allowAgain(interest) }
                  : {
                      key: 'never',
                      label: t('goose.story.menu.never', { topic: interest.topic }),
                      icon: 'eye-off',
                      tone: 'danger',
                      onPress: () =>
                        setTimeout(() => {
                          void ask({ title: t('goose.story.neverTitle', { topic: interest.topic }), message: t('goose.story.neverBody'), confirmLabel: t('goose.story.neverConfirm'), destructive: true }).then(
                            (yes) => yes && void interests.actions.never(interest),
                          );
                        }, AFTER_MENU_MS),
                    },
                {
                  key: 'remove',
                  label: t('goose.following.remove', { topic: interest.topic }),
                  icon: 'trash',
                  tone: 'danger',
                  onPress: () => {
                    void interests.actions.remove(interest);
                    router.back();
                  },
                },
              ]}
              trigger={({ onPress }) => (
                <GPressable onPress={onPress} accessibilityRole="button" accessibilityLabel={t('goose.interest.menu', { topic: interest.topic })} style={styles.pillButton}>
                  <GIcon name="more" size={22} color={theme.color.text} />
                </GPressable>
              )}
            />
          </View>
        ) : null}
      </View>
      <InterestSheet open={editing} interest={interest} onClose={() => setEditing(false)} onSave={(edit) => (interest ? interests.actions.edit(interest.id, edit) : Promise.resolve(null))} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  head: { gap: Spacing.sm },
  tile: { width: 64, height: 64, marginBottom: Spacing.xs },
  center: { alignItems: 'center', justifyContent: 'center' },
  facets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: Spacing.xs },
  facet: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  section: { gap: Spacing.md },
  divided: { borderTopWidth: StyleSheet.hairlineWidth },
  topBar: { position: 'absolute', left: Spacing.lg, right: Spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  pillButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
