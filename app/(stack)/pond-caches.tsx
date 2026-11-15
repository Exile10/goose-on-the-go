// What the Pond keeps only to be quicker. Each cache says what clearing it costs before it is cleared.

import React, { useCallback } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkEdge, InkSpinner, inkText, useInkTheme } from '@/components/ui/ink';

import { DangerQuietButton } from '@/components/pond/danger-quiet-button';
import { AdminLockView } from '@/components/pond/admin-lock';
import { IconTile, SettingsMessage } from '@/components/settings/settings-list';
import { SettingsNotice, SettingsScroll } from '@/components/settings/settings-scroll';
import { useSettingsColors, useSettingsStyles, type SettingsColors, type SettingsMetrics, type SettingsType } from '@/components/settings/settings-theme';
import { GIcon } from '@/components/ui/g-icon';
import { Spacing } from '@/constants/spacing';
import { sizeWords } from '@/models/pond-admin';
import { confirm } from '@/services/haptics';
import type { AdminCache, AdminCacheId } from '@/services/types';
import { cacheEffect, cacheIcon, cacheLabel, cacheTile } from '@/view-models/pond-admin-words';
import { usePondCaches } from '@/view-models/use-pond-caches';

function CacheCard({
  cache,
  freed,
  clearing,
  onClear,
}: {
  cache: AdminCache;
  freed: number | undefined;
  clearing: AdminCacheId | null;
  onClear: (id: AdminCacheId) => void;
}) {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  const theme = useInkTheme();
  const name = cacheLabel(cache.id);
  const empty = cache.bytes === 0;
  const heading = inkText(theme, { size: 'md', weight: theme.weight.bold }).style;
  return (
    <InkEdge raised={false} radius={theme.radius.lg} style={styles.cardWrap} contentStyle={styles.card}>
      <View style={styles.cardHead} accessible accessibilityLabel={`${name}, ${empty ? t('myPond.caches.empty') : sizeWords(cache.bytes)}`}>
        <IconTile icon={cacheIcon(cache.id)} tile={cacheTile(cache.id)} size={34} />
        <Text style={[heading, styles.cardName]}>{name}</Text>
        <Text style={[heading, styles.cardSize, empty && { color: colors.textSecondary }]}>
          {empty ? t('myPond.caches.empty') : sizeWords(cache.bytes)}
        </Text>
      </View>
      <Text style={styles.body}>
        {empty ? `${cacheEffect(cache.id)} ${t('myPond.caches.nothingNow')}` : cacheEffect(cache.id)}
      </Text>
      {freed !== undefined ? (
        <Text style={[styles.body, { color: colors.success }]} accessibilityLiveRegion="polite">
          {t('myPond.caches.freed', { size: sizeWords(freed) })}
        </Text>
      ) : null}
      {empty ? (
        <View style={styles.tidy}>
          <GIcon name="check" size={16} color={colors.success} strokeWidth={2.4} />
          <Text style={[styles.tidyText, { color: colors.success }]}>{t('myPond.caches.tidy')}</Text>
        </View>
      ) : (
        <DangerQuietButton disabled={clearing !== null} onPress={() => onClear(cache.id)}>
          {clearing === cache.id ? t('myPond.caches.clearing') : t('myPond.caches.clearSize', { size: sizeWords(cache.bytes) })}
        </DangerQuietButton>
      )}
    </InkEdge>
  );
}

export default function PondCachesScreen() {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const theme = useInkTheme();
  const { gate, caches, total, loading, failed, error, freed, clearing, actions } = usePondCaches();

  const clear = useCallback(
    async (id: AdminCacheId) => {
      if (await actions.clear(id)) void confirm();
    },
    [actions],
  );

  if (gate.phase !== 'unlocked' && gate.phase !== 'checking') {
    return (
      <SettingsScroll typing>
        <AdminLockView onRetry={() => void actions.refresh()} />
      </SettingsScroll>
    );
  }

  return (
    <SettingsScroll refreshControl={<RefreshControl refreshing={false} onRefresh={() => void actions.refresh()} />}>
      <View style={styles.header}>
        {!loading && !failed ? (
          <Text style={inkText(theme, { size: '2xl', weight: theme.weight.bold, leading: 'tight' }).style} accessibilityRole="header">
            {t('myPond.caches.spare', { size: sizeWords(total) })}
          </Text>
        ) : null}
        <Text style={styles.intro}>{t('myPond.caches.intro')}</Text>
      </View>
      {error && !failed ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}

      {loading ? (
        <InkSpinner label={t('myPond.caches.loading')} />
      ) : failed ? (
        <View style={styles.failed}>
          <SettingsMessage tone="danger">{error ?? t('myPond.caches.readFailed')}</SettingsMessage>
          <InkButton variant="quiet" icon="refresh" onPress={() => void actions.refresh()}>
            {t('common.retry')}
          </InkButton>
        </View>
      ) : caches.length === 0 ? (
        <SettingsMessage>{t('myPond.caches.none')}</SettingsMessage>
      ) : (
        caches.map((cache) => (
          <CacheCard key={cache.id} cache={cache} freed={freed[cache.id]} clearing={clearing} onClear={(id) => void clear(id)} />
        ))
      )}
    </SettingsScroll>
  );
}

const makeStyles = (c: SettingsColors, type: SettingsType, m: SettingsMetrics) => ({
  header: { gap: Spacing.xs, marginBottom: Spacing.lg },
  intro: { ...type.prose, fontSize: type.body.fontSize, lineHeight: type.body.lineHeight },
  failed: { alignItems: 'center' as const, gap: Spacing.md },
  cardWrap: { marginBottom: Spacing.lg },
  card: { gap: Spacing.sm + 2, padding: m.rowH },
  cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.md },
  cardName: { flex: 1 },
  cardSize: { fontVariant: ['tabular-nums' as const] },
  body: { ...type.prose, fontSize: type.body.fontSize, lineHeight: type.body.lineHeight },
  tidy: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, minHeight: m.tapMin },
  tidyText: type.label,
});
