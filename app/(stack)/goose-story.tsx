/**
 * A story, for reading: a very large headline, the dek, who wrote it and from what, the picture
 * full width, Goose's summary in comfortable type, why it is for the member as a quiet aside, the
 * sources, and the way out to the page itself. The title bar gives way to floating controls: back
 * on the left, a pill of thumbs, share and more on the right, and at the foot a way home to My Goose
 * and a search. Opening it marks it read.
 */

import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InkButton, InkSpinner, InkText, inkText, useInkTheme } from '@jarida/ink/native';

import { HubPicture } from '@/components/goose/hub-picture';
import { RoundButton } from '@/components/goose/hub-parts';
import { StoryMenu } from '@/components/goose/news-cards';
import { ChromePuck } from '@/components/patterns/chrome-puck';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { Markdown } from '@/components/patterns/markdown';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Spacing } from '@/constants/spacing';
import { isUnavailable } from '@/models/content-state';
import { selectionTick, tap } from '@/services/haptics';
import { Storage } from '@/services/storage';
import { useContentState } from '@/view-models/use-content-state';
import { useInterests } from '@/view-models/use-interests';
import { useStory, useStoryActions } from '@/view-models/use-news';

type ReaderSize = 'md' | 'lg';

function PillButton({ icon, label, onPress, on }: { icon: 'thumbs-up' | 'thumbs-down' | 'share'; label: string; onPress: () => void; on?: boolean }) {
  const theme = useInkTheme();
  return (
    <GPressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={on === undefined ? undefined : { selected: on }} hitSlop={4} style={styles.pillButton}>
      <GIcon name={icon} size={20} color={on ? theme.color.accentLine : theme.color.text} strokeWidth={on ? 2.6 : 2} />
    </GPressable>
  );
}

export default function GooseStoryScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const theme = useInkTheme();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const story = useStory(id);
  const actions = useStoryActions();
  const interests = useInterests();
  const [size, setSize] = useState<ReaderSize>('lg');
  const detail = story.data;
  const state = useContentState({ loading: story.loading, failed: story.failed, hasContent: !!detail });

  useEffect(() => {
    void Storage.get('readerTextSize').then((saved) => (saved === 'md' || saved === 'lg') && setSize(saved));
  }, []);
  const switchSize = () => {
    const next: ReaderSize = size === 'lg' ? 'md' : 'lg';
    setSize(next);
    void Storage.set('readerTextSize', next);
  };

  const interest = detail?.interest ? interests.data.find((i) => i.id === detail.interest?.id) : undefined;
  const site = detail?.source.name || detail?.sources[0]?.site || '';
  const headline = inkText(theme, { role: 'display', size: '3xl', weight: 700, tracking: 'title', leading: 'tight', color: theme.color.text }).style;
  const dek = inkText(theme, { role: 'display', size: 'lg', weight: 500, leading: 'snug', color: theme.color.textSecondary }).style;
  const when = detail?.publishedAt ?? detail?.writtenAt;
  const date = when ? new Date(when).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }) : null;

  const share = async () => {
    if (!detail) return;
    void tap();
    await Share.share({ message: detail.source.url ? `${detail.headline}\n${detail.source.url}` : detail.headline }).catch(() => undefined);
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 64, paddingBottom: insets.bottom + 120 }} showsVerticalScrollIndicator={false}>
        {state === 'loading' ? <InkSpinner label={t('goose.story.loading')} /> : null}
        {isUnavailable(state) ? (
          <View style={styles.gutter}>
            <ContentUnavailable state={state} reason={story.error} onRetry={story.reload} />
          </View>
        ) : null}
        {detail ? (
          <View style={styles.article}>
            <View style={[styles.gutter, styles.top]}>
              {detail.interest ? (
                <InkText size="sm" weight="bold" style={{ color: theme.color.accentLine }}>
                  {detail.kind === 'long_read' ? t('goose.story.longReadOn', { topic: detail.interest.topic }) : detail.interest.topic}
                </InkText>
              ) : null}
              <Text style={headline} accessibilityRole="header">
                {detail.headline}
              </Text>
              {detail.dek ? <Text style={dek}>{detail.dek}</Text> : null}
              <InkText size="sm" tone="secondary">
                {[site ? t('goose.story.byline', { site }) : t('goose.story.bylineNoSite'), date].filter(Boolean).join('. ')}
              </InkText>
            </View>

            {detail.picture ? (
              <View style={styles.figure}>
                <HubPicture path={detail.picture} label={detail.headline} style={styles.picture} icon="news" iconSize={40} />
                {site ? (
                  <View style={styles.gutter}>
                    <InkText size="xs" tone="secondary">
                      {t('goose.story.pictureFrom', { site })}
                    </InkText>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={[styles.gutter, styles.body]}>
              {detail.summary ? <Markdown source={detail.summary} size={size} /> : null}

              {detail.whyYou ? (
                <View style={[styles.aside, { borderLeftColor: theme.color.accentLine, backgroundColor: theme.color.accentSofter }]}>
                  <InkText size="sm" weight="bold" tone="secondary">
                    {t('goose.ideas.why')}
                  </InkText>
                  <InkText size="md">{detail.whyYou}</InkText>
                </View>
              ) : null}

              {detail.sources.length ? (
                <View style={styles.sources}>
                  <InkText size="sm" weight="bold" tone="secondary">
                    {t('goose.story.sources')}
                  </InkText>
                  {detail.sources.map((s) => (
                    <GPressable key={s.url} onPress={() => void Linking.openURL(s.url)} accessibilityRole="link" accessibilityLabel={t('goose.story.openSource', { site: s.site })} style={styles.source}>
                      <GIcon name="external" size={15} color={theme.color.accentLine} />
                      <View style={{ flex: 1 }}>
                        <InkText size="md" weight="semibold" numberOfLines={2}>
                          {s.title}
                        </InkText>
                        <InkText size="sm" tone="secondary">
                          {s.site}
                        </InkText>
                      </View>
                    </GPressable>
                  ))}
                </View>
              ) : null}

              {detail.source.url ? (
                <InkButton variant="primary" icon="external" block onPress={() => void Linking.openURL(detail.source.url!)}>
                  {t('goose.story.readOn', { site: site || t('goose.story.thePage') })}
                </InkButton>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.topBar, { top: insets.top + Spacing.sm }]} pointerEvents="box-none">
        <RoundButton icon="chevron-left" size={40} label={t('common.back')} onPress={() => router.back()} />
        {detail ? (
          <View style={[styles.pill, { backgroundColor: theme.color.chrome, borderColor: theme.color.lineStrong }]}>
            <PillButton icon="thumbs-up" label={t('goose.story.moreLikeThis')} on={story.vote === 'up'} onPress={() => void story.actions.feedback('up')} />
            <PillButton icon="thumbs-down" label={t('goose.story.lessLikeThis')} on={story.vote === 'down'} onPress={() => void story.actions.feedback('down')} />
            <PillButton icon="share" label={t('goose.story.share')} onPress={() => void share()} />
            <StoryMenu
              story={detail}
              actions={actions}
              followed={interest ? interest.news !== 'off' : null}
              onTextSize={switchSize}
              bodyForSave={{ body: detail.summary, sources: detail.sources.map((s) => ({ title: s.title, url: s.url })) }}
              size="md"
            />
          </View>
        ) : null}
      </View>

      <View style={[styles.bottomBar, { bottom: insets.bottom + Spacing.md }]} pointerEvents="box-none">
        <ChromePuck
          icon="home"
          label={t('goose.story.backToMyGoose')}
          onPress={() => {
            void selectionTick();
            router.navigate('/(tabs)/goose');
          }}
        />
        <ChromePuck
          icon="search"
          label={t('goose.search.title')}
          onPress={() => {
            void selectionTick();
            router.push('/(stack)/goose-search');
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  gutter: { paddingHorizontal: Spacing.xl },
  article: { gap: Spacing.xl },
  top: { gap: Spacing.md },
  figure: { gap: Spacing.sm },
  picture: { width: '100%', aspectRatio: 3 / 2 },
  body: { gap: Spacing['2xl'] },
  aside: { borderLeftWidth: 3, padding: Spacing.md, gap: 4, borderRadius: 4 },
  sources: { gap: Spacing.md },
  source: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  topBar: { position: 'absolute', left: Spacing.lg, right: Spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  pillButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  bottomBar: { position: 'absolute', left: Spacing.lg, right: Spacing.lg, flexDirection: 'row', justifyContent: 'space-between' },
});
