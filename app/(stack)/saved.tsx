/**
 * SavedScreen — what the member kept from the assistant's work, as cards in collections: their own
 * and the household's shared ones. Saving happens in a conversation ("keep that recipe") or from a
 * report's option; this is where the cards are found again.
 */

import React, { useEffect } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkCard, InkChip, InkEmptyState, InkNotice, InkSpinner, InkText } from '@jarida/ink/native';

import { GPressable } from '@/components/ui/g-pressable';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { SavedItem } from '@/models/web-watches';
import { selectionTick } from '@/services/haptics';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { savedKindKey, savedSummary } from '@/view-models/saved-words';
import { useSavedItems } from '@/view-models/use-saved-items';

export default function SavedScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const { data, loading, error, actions } = useSavedItems();
  const pull = usePullToRefresh(actions.refresh);
  // My Goose opens this on one collection (Saved stories), or on what others shared with the member.
  const params = useLocalSearchParams<{ collection?: string; shared?: string }>();
  const sharedOnly = params.shared === '1';
  const { setCollection } = actions;
  useEffect(() => {
    if (params.collection) setCollection(params.collection);
  }, [params.collection, setCollection]);
  const items = sharedOnly ? data.items.filter((i) => i.shared && !i.mine) : data.items;

  const open = (item: SavedItem) => {
    void selectionTick();
    router.push({ pathname: '/(stack)/saved-item', params: { id: item.id } } as never);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl {...pull} />}
    >
      <InkText size="sm" tone="secondary">{t('saved.intro')}</InkText>
      {data.collections.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <InkChip selected={data.collection === null} onPress={() => actions.setCollection(null)}>
            {t('saved.all')}
          </InkChip>
          {data.collections.map((c) => (
            <InkChip key={c.name} selected={data.collection === c.name} onPress={() => actions.setCollection(c.name)}>
              {t('saved.collection', { name: c.name, count: c.count })}
            </InkChip>
          ))}
        </ScrollView>
      ) : null}
      {loading && items.length === 0 ? <InkSpinner label={t('saved.loading')} /> : null}
      {error ? <InkNotice tone="danger">{error}</InkNotice> : null}
      {!loading && !error && items.length === 0 ? (
        <InkEmptyState icon="folder" title={t('saved.emptyTitle')}>
          <InkText>{t('saved.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}
      {items.map((item) => (
        <GPressable key={item.id} onPress={() => open(item)} accessibilityRole="button" accessibilityLabel={item.title}>
          <InkCard>
            <InkText size="xs" tone="tertiary">
              {[t(savedKindKey(item.kind)), item.collection, item.shared ? t('saved.shared') : null].filter(Boolean).join(' · ')}
            </InkText>
            <InkText weight="semibold" numberOfLines={2}>{item.title}</InkText>
            {savedSummary(item) ? (
              <View>
                <InkText size="sm" tone="secondary" numberOfLines={2}>{savedSummary(item)}</InkText>
              </View>
            ) : null}
          </InkCard>
        </GPressable>
      ))}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing['4xl'] },
    chips: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  });
