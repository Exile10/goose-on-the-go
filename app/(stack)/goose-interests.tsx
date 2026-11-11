/**
 * What Goose knows you're into: the member's interests in their own order, the guesses Goose has
 * made from chats to confirm or dismiss, the topics they asked never to see, and Goose's own
 * account of them. Edit reorders, mutes or removes; tapping an interest opens its page.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkSpinner, InkText, inkText, useInkTheme } from '@/components/ui/ink';

import { GroupHeading, GroupRow, InsetGroup } from '@/components/goose/following';
import { RoundButton, ScreenScroll } from '@/components/goose/hub-parts';
import { InterestSheet } from '@/components/goose/interest-sheet';
import { InterestsGroup } from '@/components/goose/interests-group';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { GPressable } from '@/components/ui/g-pressable';
import { Spacing } from '@/constants/spacing';
import { categoriesOf, categoryIcon, categoryKey, initialOf } from '@/models/interests';
import { isUnavailable } from '@/models/content-state';
import { tap } from '@/services/haptics';
import { useContentState } from '@/view-models/use-content-state';
import { useInterests } from '@/view-models/use-interests';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

export default function GooseInterestsScreen() {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ add?: string }>();
  const interests = useInterests();
  const pull = usePullToRefresh(interests.actions.reload);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(params.add === '1');
  const { confirmed, avoided } = interests.groups;
  const state = useContentState({ loading: interests.loading, failed: interests.failed, hasContent: interests.data.length > 0 });
  const title = inkText(theme, { role: 'display', size: '3xl', weight: 700, tracking: 'title', color: theme.color.text }).style;

  return (
    <ScreenScroll pull={pull}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={title} accessibilityRole="header">
            {t('myGoose.title')}
          </Text>
          <InkText size="lg" weight="semibold" tone="secondary">
            {t('goose.interests.screenSubtitle')}
          </InkText>
        </View>
        {confirmed.length ? (
          <GPressable
            onPress={() => {
              void tap();
              setEditing((e) => !e);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: editing }}
            style={[styles.pill, { backgroundColor: editing ? theme.color.accent : theme.color.chrome, borderColor: editing ? theme.color.accent : theme.color.lineStrong }]}
          >
            <InkText size="md" weight="semibold" style={{ color: editing ? theme.color.textOnAccent : theme.color.text }}>
              {editing ? t('goose.following.done') : t('goose.following.edit')}
            </InkText>
          </GPressable>
        ) : null}
      </View>

      {state === 'loading' ? <InkSpinner label={t('goose.interests.loading')} /> : null}
      {isUnavailable(state) ? <ContentUnavailable state={state} reason={interests.error} onRetry={interests.actions.reload} /> : null}

      {state === 'empty' ? (
        <InkCard>
          <InkText size="xl" weight="bold">
            {t('goose.invite.title')}
          </InkText>
          <InkText tone="secondary">{t('goose.invite.body')}</InkText>
          <View style={styles.row}>
            <InkButton variant="primary" icon="chat" onPress={() => router.push('/(stack)/goose-interview')}>
              {t('goose.invite.start')}
            </InkButton>
            <InkButton variant="quiet" icon="plus" onPress={() => setAdding(true)}>
              {t('goose.invite.addOne')}
            </InkButton>
          </View>
        </InkCard>
      ) : null}

      {interests.data.length ? (
        <View style={styles.group}>
          <GroupHeading title={t('goose.following.interests')} />
          <InterestsGroup interests={interests} editing={editing} onAdd={() => setAdding(true)} />
        </View>
      ) : null}

      {categoriesOf(confirmed).length ? (
        <View style={styles.group}>
          <GroupHeading title={t('goose.following.sections')} />
          <InsetGroup>
            {categoriesOf(confirmed).map((s, i) => (
              <GroupRow
                key={s.category}
                first={i === 0}
                icon={categoryIcon(s.category)}
                label={t(categoryKey(s.category))}
                detail={s.interests.map((x) => x.topic).join(', ')}
                onPress={() => router.push({ pathname: '/(stack)/goose-section', params: { category: s.category } })}
              />
            ))}
          </InsetGroup>
        </View>
      ) : null}

      {avoided.length ? (
        <View style={styles.group}>
          <GroupHeading title={t('goose.interests.neverShown')} />
          <InsetGroup>
            {avoided.map((a, i) => (
              <GroupRow
                key={a.id}
                first={i === 0}
                initial={initialOf(a.topic)}
                picture={a.picture}
                label={a.topic}
                muted
                trailing={<RoundButton icon="eye" size={30} label={t('goose.interests.allowAgain')} onPress={() => void interests.actions.allowAgain(a)} />}
              />
            ))}
          </InsetGroup>
        </View>
      ) : null}

      {interests.portrait ? (
        <View style={[styles.portrait, { borderLeftColor: theme.color.accentLine }]}>
          <InkText size="sm" weight="bold" tone="secondary">
            {t('goose.interests.portrait')}
          </InkText>
          <InkText size="md">{interests.portrait.summary}</InkText>
          {interests.portrait.workingOn.length ? (
            <InkText size="sm" tone="secondary">
              {t('goose.interests.workingOn', { things: interests.portrait.workingOn.join(', ') })}
            </InkText>
          ) : null}
        </View>
      ) : null}

      <InterestSheet open={adding} interest={null} onClose={() => setAdding(false)} onSave={(edit) => interests.actions.add(edit)} />
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  pill: { paddingHorizontal: Spacing.lg, paddingVertical: 7, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  group: { gap: Spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  portrait: { borderLeftWidth: 3, paddingLeft: Spacing.md, gap: 4 },
});
