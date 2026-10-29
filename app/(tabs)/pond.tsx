// My Pond: the Pond's administration, behind its administrator card. Locked, it is the card's form;
// open, it is what the Pond holds and the ways in to tidying it.

import React, { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InkBadge, InkButton, InkMeter, InkSpinner, InkText, InkTitle } from '@jarida/ink/native';

import { AdminLockView } from '@/components/pond/admin-lock';
import { PAGE_GUTTER, SettingsNotice } from '@/components/settings/settings-scroll';
import { SettingsGroup, SettingsRow, TILE_INSET } from '@/components/settings/settings-list';
import { useSettingsColors } from '@/components/settings/settings-theme';
import type { TileColor } from '@/constants/colors';
import type { IconName } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { sizeWords } from '@/models/pond-admin';
import { useBottomBarInset, useChromeScroll } from '@/providers/chrome-provider';
import { confirm, reject, selectionTick, tap } from '@/services/haptics';
import type { TranslationKey } from '@/services/i18n';
import { useMyPond } from '@/view-models/use-my-pond';

const PLACES: { route: string; labelKey: TranslationKey; descriptionKey: TranslationKey; icon: IconName; tile: TileColor; id: string }[] = [
  { id: 'files', route: '/(stack)/pond-files', labelKey: 'screens.pondFiles', descriptionKey: 'myPond.menu.files', icon: 'folder', tile: 'blue' },
  { id: 'caches', route: '/(stack)/pond-caches', labelKey: 'screens.pondCaches', descriptionKey: 'myPond.menu.caches', icon: 'archive', tile: 'teal' },
  { id: 'tasks', route: '/(stack)/pond-tasks', labelKey: 'screens.pondTasks', descriptionKey: 'myPond.menu.tasks', icon: 'logs', tile: 'indigo' },
  { id: 'health', route: '/(stack)/pond-health', labelKey: 'screens.pondHealth', descriptionKey: 'myPond.menu.health', icon: 'activity', tile: 'green' },
  { id: 'power', route: '/(stack)/pond-power', labelKey: 'screens.pondPower', descriptionKey: 'myPond.menu.power', icon: 'power', tile: 'amber' },
];

function count(n: number | null): string | null {
  return n === null ? null : n.toLocaleString();
}

export default function MyPondTab() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useSettingsColors();
  const chrome = useChromeScroll();
  const bottomInset = useBottomBarInset();
  const { gate, overview, areas, disk, locksIn, healthWarning, loading, refreshing, error, locking, actions } = useMyPond();

  const go = useCallback(
    (route: string) => {
      void selectionTick();
      router.push(route as never);
    },
    [router],
  );

  const lock = useCallback(async () => {
    void tap();
    const ok = await actions.lock();
    void (ok ? confirm() : reject());
  }, [actions]);

  const open = gate.phase === 'unlocked';
  const counts = overview?.counts;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.page }]} edges={['top']}>
      <ScrollView
        {...chrome}
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + Spacing.lg }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void actions.refresh()} />}
      >
        <InkTitle style={styles.title}>{t('tabs.pond')}</InkTitle>

        {!open ? (
          <AdminLockView onRetry={() => void actions.refresh()} />
        ) : (
          <>
            <View style={styles.lockRow}>
              <View style={styles.lockText}>
                <InkText size="md" weight="semibold">
                  {t('myPond.unlocked')}
                </InkText>
                <InkText size="sm" tone="secondary">
                  {locksIn === null
                    ? t('myPond.locksIdle', { minutes: gate.status?.idle_minutes ?? 15 })
                    : locksIn === 0
                      ? t('myPond.locksNow')
                      : t('myPond.locksIn', { count: locksIn })}
                </InkText>
              </View>
              <InkButton variant="quiet" icon="lock" disabled={locking} onPress={() => void lock()}>
                {t('myPond.lock.lock')}
              </InkButton>
            </View>

            {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}

            {loading ? (
              <InkSpinner label={t('myPond.overview.loading')} />
            ) : overview && disk ? (
              <>
                <SettingsGroup title={t('myPond.overview.disk')}>
                  <View style={styles.meter}>
                    <InkText size="md" weight="semibold">
                      {t('myPond.overview.used', { used: sizeWords(disk.used), total: sizeWords(disk.total) })}
                    </InkText>
                    <InkMeter value={disk.fraction} label={t('myPond.overview.meterLabel', { percent: Math.round(disk.fraction * 100) })} />
                    <InkText size="sm" tone="secondary">
                      {t('myPond.overview.free', { free: sizeWords(disk.free) })}
                    </InkText>
                  </View>
                </SettingsGroup>

                <SettingsGroup
                  title={t('myPond.overview.byArea')}
                  footer={t('myPond.overview.dataDir', { size: sizeWords(overview.data_dir_bytes) })}
                >
                  {areas.map((a) => (
                    <SettingsRow key={a.id} label={a.label} value={sizeWords(a.bytes)} />
                  ))}
                </SettingsGroup>

                <SettingsGroup title={t('myPond.overview.holds')}>
                  <SettingsRow label={t('myPond.count.conversations')} value={count(counts?.sessions ?? null)} />
                  <SettingsRow label={t('myPond.count.messages')} value={count(counts?.messages ?? null)} />
                  <SettingsRow label={t('myPond.count.memories')} value={count(counts?.memories ?? null)} />
                  <SettingsRow label={t('myPond.count.tasks')} value={count(counts?.long_tasks ?? null)} />
                  <SettingsRow label={t('myPond.count.artifacts')} value={count(counts?.artifacts ?? null)} />
                  <SettingsRow label={t('myPond.count.models')} value={count(counts?.models ?? null)} />
                </SettingsGroup>
              </>
            ) : null}

            <SettingsGroup inset={TILE_INSET}>
              {PLACES.map((p) => (
                <SettingsRow
                  key={p.id}
                  label={t(p.labelKey)}
                  description={p.id === 'health' && healthWarning ? t('myPond.menu.healthWarning') : t(p.descriptionKey)}
                  icon={p.icon}
                  tile={p.tile}
                  trailing={p.id === 'health' && healthWarning ? <InkBadge tone="warning">{t('myPond.health.attention')}</InkBadge> : null}
                  accessory="next"
                  onPress={() => go(p.route)}
                />
              ))}
            </SettingsGroup>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: PAGE_GUTTER },
  title: { marginTop: Spacing.md, marginBottom: Spacing.lg },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.xl },
  lockText: { flex: 1, gap: 2 },
  meter: { gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.lg },
});
