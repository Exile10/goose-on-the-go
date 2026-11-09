/**
 * WebWatchesScreen — the pages the Pond keeps checking for this member, each with what it is
 * looking for, how often it checks, and how many listings match now. A watch is started from a
 * conversation, where the page is read first; this is where it is followed and changed.
 */

import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkCard, InkEmptyState, InkNotice, InkSpinner, InkText } from '@jarida/ink/native';

import { GPressable } from '@/components/ui/g-pressable';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { WebWatch } from '@/models/web-watches';
import { selectionTick } from '@/services/haptics';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { useWebWatches } from '@/view-models/use-web-watches';

export default function WebWatchesScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const { data, loading, error, actions } = useWebWatches();
  const pull = usePullToRefresh(actions.refresh);

  const open = (watch: WebWatch) => {
    void selectionTick();
    router.push({ pathname: '/(stack)/web-watch', params: { id: watch.id } } as never);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl {...pull} />}
    >
      <InkText size="sm" tone="secondary">{t('webWatches.intro')}</InkText>
      {loading && data.watches.length === 0 ? <InkSpinner label={t('webWatches.loading')} /> : null}
      {error ? <InkNotice tone="danger">{error}</InkNotice> : null}
      {!loading && !error && data.watches.length === 0 ? (
        <InkEmptyState icon="eye" title={t('webWatches.emptyTitle')}>
          <InkText>{t('webWatches.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}
      {data.watches.map((watch) => (
        <GPressable key={watch.id} onPress={() => open(watch)} accessibilityRole="button" accessibilityLabel={watch.title}>
          <InkCard>
            <InkText weight="semibold" numberOfLines={2}>{watch.title}</InkText>
            <InkText size="sm" tone="secondary">{t('webWatches.lookingFor', { what: watch.filtersWords || watch.lookingFor })}</InkText>
            <View style={styles.footer}>
              <InkText size="sm" tone="tertiary">
                {watch.paused ? t('webWatches.paused') : t('webWatches.every', { count: watch.intervalHours })}
              </InkText>
              <InkText size="sm" tone={watch.matchingCount > 0 ? 'default' : 'tertiary'}>
                {t('webWatches.matching', { count: watch.matchingCount, total: watch.itemsCount })}
              </InkText>
            </View>
            {watch.failures >= 3 ? <InkNotice tone="warning">{t('webWatches.failing')}</InkNotice> : null}
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
    footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.sm },
  });
