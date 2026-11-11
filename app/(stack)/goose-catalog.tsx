/**
 * More your Goose can do: what this Pond has switched on, and what it could. An item opens its
 * screen, or starts a chat that tries it.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkSpinner, InkText, useInkTheme } from '@jarida/ink/native';

import { openCatalogItem } from '@/components/goose/hub-my-goose';
import { ScreenScroll, SectionHead } from '@/components/goose/hub-parts';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { iconOr } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import type { CatalogItem } from '@/models/catalog';
import { isUnavailable } from '@/models/content-state';
import { useCatalog } from '@/view-models/use-catalog';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

function Item({ item }: { item: CatalogItem }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const stateWord = item.state === 'on' ? t('goose.catalog.on') : item.state === 'off' ? t('goose.catalog.off') : t('goose.catalog.needsSetup');
  const action = item.opens ? (item.state === 'needs_setup' ? t('goose.catalog.setUp') : t('goose.catalog.open')) : item.try ? t('goose.catalog.try') : null;
  return (
    <GPressable onPress={() => openCatalogItem(item)} disabled={!action} accessibilityRole="button" accessibilityLabel={`${item.title}. ${stateWord}`} style={styles.item}>
      <View style={[styles.tile, { backgroundColor: theme.color.accentSoft }]}>
        <GIcon name={iconOr(item.icon, 'sparkle')} size={22} color={theme.color.accentLine} />
      </View>
      <View style={styles.words}>
        <InkText size="md" weight="bold">
          {item.title}
        </InkText>
        <InkText size="sm" tone="secondary">
          {item.body}
        </InkText>
        {item.try ? (
          <InkText size="sm" weight="semibold" style={{ color: theme.color.accentLine }}>
            {t('goose.catalog.tryPrompt', { prompt: item.try })}
          </InkText>
        ) : null}
      </View>
      <View style={styles.side}>
        <InkText size="xs" weight="semibold" style={{ color: item.state === 'on' ? theme.color.successFg : item.state === 'needs_setup' ? theme.color.warningFg : theme.color.textSecondary }}>
          {stateWord}
        </InkText>
        {action ? <GIcon name="chevron-right" size={18} color={theme.color.textTertiary} /> : null}
      </View>
    </GPressable>
  );
}

export default function GooseCatalogScreen() {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const catalog = useCatalog();
  const pull = usePullToRefresh(catalog.reload);
  const state = useContentState({ loading: catalog.loading, failed: catalog.failed, hasContent: catalog.data.length > 0 });
  return (
    <ScreenScroll pull={pull}>
      <SectionHead title={t('goose.catalog.title')} subtitle={t('goose.catalog.subtitle')} />
      {state === 'loading' ? <InkSpinner label={t('goose.catalog.loading')} /> : null}
      {isUnavailable(state) ? <ContentUnavailable state={state} reason={catalog.error} onRetry={catalog.reload} /> : null}
      <View>
        {catalog.data.map((item, i) => (
          <View key={item.id} style={i > 0 ? [styles.divided, { borderTopColor: theme.color.line }] : null}>
            <Item item={item} />
          </View>
        ))}
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, paddingVertical: Spacing.md },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  words: { flex: 1, gap: 3 },
  side: { alignItems: 'flex-end', gap: 4 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth },
});
