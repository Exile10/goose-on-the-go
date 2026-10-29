// The Pond's data folder, one folder at a time, largest first. What the Pond keeps says why.

import React, { useCallback } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkSpinner } from '@jarida/ink/native';

import { AdminLockView } from '@/components/pond/admin-lock';
import { SettingsGroup, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import { SettingsNotice, SettingsScroll } from '@/components/settings/settings-scroll';
import { useSettingsColors, useSettingsStyles, type SettingsColors, type SettingsType } from '@/components/settings/settings-theme';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { IconName } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { sizeWords } from '@/models/pond-admin';
import { confirm, selectionTick } from '@/services/haptics';
import type { AdminFileEntry } from '@/services/types';
import { keepReasonWords, whenWords } from '@/view-models/pond-admin-words';
import { usePondFiles } from '@/view-models/use-pond-files';

const KIND_ICON: Record<AdminFileEntry['kind'], IconName> = {
  directory: 'folder',
  file: 'file',
  symlink: 'link',
};

export default function PondFilesScreen() {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  const { gate, path, crumbs, entries, loading, failed, error, notice, removing, actions } = usePondFiles();

  const remove = useCallback(
    async (entry: AdminFileEntry) => {
      if (await actions.remove(entry)) void confirm();
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}>
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          const label = crumb.name ?? t('myPond.files.root');
          return (
            <View key={crumb.path} style={styles.crumb}>
              {i > 0 ? <GIcon name="chevron-right" size={14} color={colors.textTertiary} /> : null}
              {last ? (
                <Text style={styles.crumbHere} accessibilityRole="header">
                  {label}
                </Text>
              ) : (
                <GPressable
                  hitSlop={8}
                  onPress={() => {
                    void selectionTick();
                    actions.goTo(crumb.path);
                  }}
                  accessibilityRole="link"
                  accessibilityLabel={t('myPond.files.goTo', { name: label })}
                >
                  <Text style={styles.crumbLink}>{label}</Text>
                </GPressable>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View accessibilityLiveRegion="polite">{notice ? <SettingsNotice tone="success">{notice}</SettingsNotice> : null}</View>
      {error && !failed ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}

      {loading ? (
        <InkSpinner label={t('myPond.files.loading')} />
      ) : failed ? (
        <View style={styles.failed}>
          <SettingsMessage tone="danger">{error ?? t('myPond.files.readFailed')}</SettingsMessage>
          <InkButton variant="quiet" icon="refresh" onPress={() => void actions.refresh()}>
            {t('common.retry')}
          </InkButton>
        </View>
      ) : entries.length === 0 ? (
        <SettingsMessage>{path === '' ? t('myPond.files.emptyRoot') : t('myPond.files.empty')}</SettingsMessage>
      ) : (
        <SettingsGroup>
          {entries.map((entry) => {
            const when = whenWords(entry.modified_at);
            const kept = !entry.deletable && entry.reason ? keepReasonWords(entry.reason) : null;
            const busy = removing === entry.path;
            return (
              // The delete control sits beside the row, not in it: a button inside a pressable row is
              // hidden from screen readers, and on the web it is a button inside a button.
              <View key={entry.path} style={styles.entry}>
                <View style={styles.entryRow}>
                  <SettingsRow
                    label={entry.name}
                    icon={KIND_ICON[entry.kind]}
                    tile={entry.kind === 'directory' ? 'blue' : 'slate'}
                    value={sizeWords(entry.bytes)}
                    description={when ? t('myPond.files.modified', { when }) : null}
                    note={kept}
                    accessory={entry.kind === 'directory' ? 'next' : 'none'}
                    onPress={entry.kind === 'directory' ? () => actions.open(entry) : undefined}
                  />
                </View>
                {entry.deletable ? (
                  <GPressable
                    hitSlop={6}
                    disabled={removing !== null}
                    onPress={() => void remove(entry)}
                    accessibilityRole="button"
                    accessibilityLabel={t('myPond.files.deleteNamed', { name: entry.name })}
                    style={styles.delete}
                  >
                    {busy ? <InkSpinner label={t('myPond.files.deleting')} size={16} /> : <GIcon name="trash" size={18} color={colors.danger} />}
                  </GPressable>
                ) : null}
              </View>
            );
          })}
        </SettingsGroup>
      )}
    </SettingsScroll>
  );
}

const makeStyles = (c: SettingsColors, type: SettingsType) => ({
  crumbs: { alignItems: 'center' as const, gap: Spacing.xs, paddingBottom: Spacing.lg },
  crumb: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.xs },
  crumbLink: { ...type.label, color: c.accent },
  crumbHere: type.label,
  failed: { alignItems: 'center' as const, gap: Spacing.md },
  entry: { flexDirection: 'row' as const, alignItems: 'stretch' as const },
  entryRow: { flex: 1 },
  delete: { justifyContent: 'center' as const, paddingLeft: Spacing.xs, paddingRight: Spacing.lg },
});
