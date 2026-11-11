/**
 * News on My Goose, in three shapes. The hero is the day's lead: a full-bleed picture, a band when
 * it is fresh, its source, a headline set large, and a way into its interest. A compact card is a
 * headline beside its picture under a band naming the interest. A long read is a cover, never a
 * headline: a tall picture with its title under it, because it is a deep dive and not today's news.
 * Every story carries the same "..." menu.
 */

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkChip, InkMenu, InkSheet, InkText, InkTextArea, inkText, useInkTheme, type InkMenuItem } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Spacing } from '@/constants/spacing';
import { isFresh, type Story } from '@/models/news';
import { useConfirm } from '@/providers/confirm-provider';
import { selectionTick } from '@/services/haptics';
import type { StoryActions } from '@/view-models/use-news';
import { HubPicture } from './hub-picture';
import { useAgo } from './hub-parts';

export function openStory(story: Pick<Story, 'id'>) {
  void selectionTick();
  router.push({ pathname: '/(stack)/goose-story', params: { id: story.id } });
}

export function openInterest(interestId: string) {
  void selectionTick();
  router.push({ pathname: '/(stack)/goose-interest', params: { id: interestId } });
}

/** A sheet opened from a menu waits for the menu's own sheet to leave; iOS dismisses one presented over a closing one. */
const AFTER_MENU_MS = 450;

export function StoryMenu({
  story,
  actions,
  followed,
  onTextSize,
  bodyForSave,
  size = 'sm',
}: {
  story: Story;
  actions: StoryActions;
  /** Whether the story's interest feeds the news, when the screen knows. */
  followed: boolean | null;
  /** The reader's own item, which only the reader has. */
  onTextSize?: () => void;
  bodyForSave?: { body: string; sources: { title: string; url: string }[] };
  size?: 'sm' | 'md';
}) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const ask = useConfirm();
  const [wrong, setWrong] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const interest = story.interest;

  const items: InkMenuItem[] = [
    ...(onTextSize ? [{ key: 'size', label: t('goose.story.menu.textSize'), icon: 'sliders' as const, onPress: onTextSize }] : []),
    { key: 'save', label: t('goose.story.menu.save'), icon: 'archive', onPress: () => void actions.save(story, bodyForSave?.body, bodyForSave?.sources) },
    ...(story.source.url ? [{ key: 'copy', label: t('goose.story.menu.copy'), icon: 'copy' as const, onPress: () => void actions.copyLink(story) }] : []),
    ...(interest?.id
      ? [
          { key: 'go', label: t('goose.story.menu.goTo', { topic: interest.topic }), icon: 'arrow' as const, onPress: () => openInterest(interest.id), separated: true },
          followed === false
            ? { key: 'follow', label: t('goose.story.menu.follow', { topic: interest.topic }), icon: 'plus' as const, onPress: () => void actions.follow(interest.id, true) }
            : { key: 'unfollow', label: t('goose.story.menu.unfollow', { topic: interest.topic }), icon: 'minus' as const, onPress: () => void actions.follow(interest.id, false) },
          {
            key: 'never',
            label: t('goose.story.menu.never', { topic: interest.topic }),
            icon: 'eye-off' as const,
            tone: 'danger' as const,
            onPress: () =>
              setTimeout(() => {
                void ask({
                  title: t('goose.story.neverTitle', { topic: interest.topic }),
                  message: t('goose.story.neverBody'),
                  confirmLabel: t('goose.story.neverConfirm'),
                  destructive: true,
                }).then((yes) => {
                  if (yes) void actions.never(interest.id);
                });
              }, AFTER_MENU_MS),
          },
        ]
      : []),
    {
      key: 'notify',
      label: t('goose.story.menu.notifications'),
      icon: 'bell',
      separated: true,
      onPress: () => router.push('/(stack)/goose-news-settings'),
    },
    { key: 'wrong', label: t('goose.story.menu.wrong'), icon: 'warn', onPress: () => setTimeout(() => setWrong(true), AFTER_MENU_MS) },
  ];

  return (
    <>
      <InkMenu
        label={t('goose.story.menu.title')}
        items={items}
        trigger={({ onPress }) => (
          <GPressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={t('goose.story.menu.open', { headline: story.headline })}
            hitSlop={10}
            style={[styles.menuDot, size === 'md' ? { width: 36, height: 36 } : null]}
          >
            <GIcon name="more" size={size === 'md' ? 22 : 20} color={theme.color.textSecondary} />
          </GPressable>
        )}
      />
      <InkSheet open={wrong} onClose={() => setWrong(false)} title={t('goose.story.wrongTitle')} description={t('goose.story.wrongBody')}>
        <View style={styles.sheet}>
          <InkTextArea value={note} onChange={setNote} label={t('goose.story.wrongNote')} placeholder={t('goose.story.wrongPlaceholder')} rows={3} />
          <InkButton
            variant="primary"
            loading={sending}
            onPress={async () => {
              setSending(true);
              const ok = await actions.wrong(story, note);
              setSending(false);
              if (ok) {
                setWrong(false);
                setNote('');
              }
            }}
          >
            {t('goose.story.wrongSend')}
          </InkButton>
        </View>
      </InkSheet>
    </>
  );
}

function NewBand() {
  const theme = useInkTheme();
  const { t } = useTranslation();
  return (
    <View style={[styles.newBand, { backgroundColor: theme.color.accent }]}>
      <Text style={inkText(theme, { size: 'sm', weight: 700, color: theme.color.textOnAccent }).style}>{t('goose.news.new')}</Text>
    </View>
  );
}

/** The day's lead story. */
export function HeroStory({ story, actions, followed }: { story: Story; actions: StoryActions; followed: boolean | null }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const ago = useAgo();
  const fresh = isFresh(story, new Date());
  const headline = inkText(theme, { role: 'display', size: '2xl', weight: 700, tracking: 'title', leading: 'tight', color: theme.color.text }).style;
  return (
    <InkCard contentStyle={styles.flush}>
      <GPressable onPress={() => openStory(story)} accessibilityRole="button" accessibilityLabel={story.headline}>
        <HubPicture path={story.picture} label={story.headline} style={styles.heroPicture} icon="news" iconSize={36} />
        {fresh ? <NewBand /> : null}
        <View style={styles.heroWords}>
          <InkText size="sm" weight="bold">
            {story.source.name || story.interest?.topic || ''}
          </InkText>
          <Text style={[headline, styles.heroHeadline]} numberOfLines={3}>
            {story.headline}
          </Text>
          {story.dek ? (
            <InkText size="md" tone="secondary" numberOfLines={2}>
              {story.dek}
            </InkText>
          ) : null}
        </View>
      </GPressable>
      <View style={styles.heroFoot}>
        {story.interest?.id ? (
          <InkChip icon="news" onPress={() => openInterest(story.interest!.id)}>
            {t('goose.news.moreOf', { topic: story.interest.topic })}
          </InkChip>
        ) : (
          <View />
        )}
        <View style={styles.footRight}>
          <InkText size="sm" tone="tertiary">
            {ago(story.publishedAt ?? story.writtenAt)}
          </InkText>
          <StoryMenu story={story} actions={actions} followed={followed} />
        </View>
      </View>
    </InkCard>
  );
}

/** A story as a headline beside its picture, under a band naming its interest. */
export function CompactStory({ story, actions, followed }: { story: Story; actions: StoryActions; followed: boolean | null }) {
  const theme = useInkTheme();
  const ago = useAgo();
  const headline = inkText(theme, { role: 'display', size: 'lg', weight: 700, tracking: 'tight', leading: 'snug', color: story.read ? theme.color.textSecondary : theme.color.text }).style;
  return (
    <InkCard raised={false} contentStyle={styles.flush}>
      <GPressable onPress={() => openStory(story)} accessibilityRole="button" accessibilityLabel={story.headline}>
        {story.interest ? (
          <View style={[styles.band, { backgroundColor: theme.color.brandSoft, borderBottomColor: theme.color.line }]}>
            <InkText size="sm" weight="bold" style={{ color: theme.color.accentLine }} numberOfLines={1}>
              {story.interest.topic}
            </InkText>
          </View>
        ) : null}
        <View style={styles.compactBody}>
          <Text style={[headline, styles.compactHeadline]} numberOfLines={4}>
            {story.headline}
          </Text>
          <HubPicture path={story.picture} label={story.headline} style={[styles.square, { borderRadius: theme.radius.md }]} icon="news" />
        </View>
      </GPressable>
      <View style={styles.compactFoot}>
        <InkText size="sm" tone="secondary" numberOfLines={1}>
          {[story.source.name, ago(story.publishedAt ?? story.writtenAt)].filter(Boolean).join(', ')}
        </InkText>
        <StoryMenu story={story} actions={actions} followed={followed} />
      </View>
    </InkCard>
  );
}

/** A long read as a cover: tall picture, title under it. Deliberately not a headline. */
export function LongReadCover({ story, width = 150 }: { story: Story; width?: number }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  return (
    <GPressable feedback="lift" onPress={() => openStory(story)} accessibilityRole="button" accessibilityLabel={t('goose.news.longReadLabel', { headline: story.headline })} style={{ width }}>
      <HubPicture path={story.picture} label={story.headline} style={[styles.cover, { width, height: Math.round(width * 1.33), borderRadius: theme.radius.lg }]} icon="file-text" iconSize={30} />
      <View style={styles.coverWords}>
        <InkText size="xs" weight="semibold" tone="secondary" numberOfLines={1}>
          {story.interest?.topic ?? t('goose.news.longRead')}
        </InkText>
        <InkText size="md" weight="bold" numberOfLines={3}>
          {story.headline}
        </InkText>
      </View>
    </GPressable>
  );
}

export function LongReadShelf({ stories }: { stories: Story[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.shelf}>
      {stories.map((s) => (
        <LongReadCover key={s.id} story={s} />
      ))}
    </ScrollView>
  );
}

/** A story as a list row: a small square picture, two lines of headline, its site. */
export function StoryRow({ story, meta }: { story: Story; meta?: string | null }) {
  const theme = useInkTheme();
  return (
    <GPressable onPress={() => openStory(story)} accessibilityRole="button" accessibilityLabel={story.headline} style={styles.row}>
      <HubPicture path={story.picture} label={story.headline} style={[styles.rowPicture, { borderRadius: theme.radius.sm }]} icon="news" iconSize={18} />
      <View style={styles.rowWords}>
        <InkText size="md" weight="bold" numberOfLines={2}>
          {story.headline}
        </InkText>
        <InkText size="sm" tone="secondary" numberOfLines={1}>
          {meta ?? story.source.name}
        </InkText>
      </View>
    </GPressable>
  );
}

const styles = StyleSheet.create({
  flush: { padding: 0, gap: 0, overflow: 'hidden' },
  heroPicture: { width: '100%', aspectRatio: 16 / 10 },
  newBand: { paddingHorizontal: Spacing.lg, paddingVertical: 6 },
  heroWords: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, gap: Spacing.xs },
  heroHeadline: { fontSize: 26, lineHeight: 31 },
  heroFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, padding: Spacing.lg, paddingTop: Spacing.md },
  footRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  menuDot: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  band: { paddingHorizontal: Spacing.lg, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth },
  compactBody: { flexDirection: 'row', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, alignItems: 'flex-start' },
  compactHeadline: { flex: 1 },
  square: { width: 84, height: 84 },
  compactFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm, paddingTop: Spacing.xs },
  sheet: { gap: Spacing.md },
  bleed: { marginHorizontal: -Spacing.lg },
  shelf: { gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xs },
  cover: {},
  coverWords: { gap: 2, paddingTop: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  rowPicture: { width: 56, height: 56 },
  rowWords: { flex: 1, gap: 2 },
});
