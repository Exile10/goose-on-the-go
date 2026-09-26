/**
 * BackupScreen — Backup status card, settings toggles, and history.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InkButton, InkSwitch, InkTitle } from '@jarida/ink/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';

import { GIcon } from '@/components/ui/g-icon';
import { Grey, Brand, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { Shadows } from '@/constants/shadows';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';

const BACKUP_HISTORY = [
  { date: 'Apr 26, 2026', size: '142 MB', status: 'complete' },
  { date: 'Apr 19, 2026', size: '138 MB', status: 'complete' },
  { date: 'Apr 12, 2026', size: '135 MB', status: 'complete' },
  { date: 'Apr 5, 2026', size: '131 MB', status: 'failed' },
];

export default function BackupScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const [autoBackup, setAutoBackup] = useState(true);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [includeMemories, setIncludeMemories] = useState(true);
  const [encryptBackup, setEncryptBackup] = useState(true);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* Status card */}
      <View style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <View style={styles.statusIconWrap}>
            <GIcon name="download" size={24} color={Semantic.success} />
          </View>
          <View style={styles.statusInfo}>
            <Text style={styles.statusTitle}>{t('backup.last')}</Text>
            <Text style={styles.statusDate}>Apr 26, 2026 at 3:00 AM</Text>
          </View>
        </View>
        <View style={styles.statusMeta}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>{t('backup.size')}</Text>
            <Text style={styles.metaValue}>142 MB</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>{t('backup.duration')}</Text>
            <Text style={styles.metaValue}>2m 14s</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>{t('backup.status')}</Text>
            <View style={[styles.statusBadge, { backgroundColor: Semantic.successSoft }]}>
              <Text style={[styles.statusBadgeText, { color: Semantic.success }]}>{t('backup.complete')}</Text>
            </View>
          </View>
        </View>
        <InkButton variant="primary" icon={<GIcon name="download" size={16} color={Brand.white} />}>
          {t('backup.now')}
        </InkButton>
      </View>

      {/* Settings toggles */}
      <InkTitle level={3}>{t('sections.backupSettings')}</InkTitle>
      <View style={styles.settingsCard}>
        <View style={styles.settingRow}>
          <View>
            <Text style={styles.settingTitle}>{t('backup.auto')}</Text>
            <Text style={styles.settingDesc}>{t('backup.autoBody')}</Text>
          </View>
          <InkSwitch checked={autoBackup} onChange={setAutoBackup} />
        </View>
        <View style={styles.divider} />
        <View style={styles.settingRow}>
          <View>
            <Text style={styles.settingTitle}>{t('backup.media')}</Text>
            <Text style={styles.settingDesc}>{t('backup.mediaBody')}</Text>
          </View>
          <InkSwitch checked={includeMedia} onChange={setIncludeMedia} />
        </View>
        <View style={styles.divider} />
        <View style={styles.settingRow}>
          <View>
            <Text style={styles.settingTitle}>{t('backup.memories')}</Text>
            <Text style={styles.settingDesc}>{t('backup.memoriesBody')}</Text>
          </View>
          <InkSwitch checked={includeMemories} onChange={setIncludeMemories} />
        </View>
        <View style={styles.divider} />
        <View style={styles.settingRow}>
          <View>
            <Text style={styles.settingTitle}>{t('backup.encrypt')}</Text>
            <Text style={styles.settingDesc}>{t('backup.encryptBody')}</Text>
          </View>
          <InkSwitch checked={encryptBackup} onChange={setEncryptBackup} />
        </View>
      </View>

      {/* History */}
      <InkTitle level={3}>{t('sections.backupHistory')}</InkTitle>
      {BACKUP_HISTORY.map((b, i) => {
        const isComplete = b.status === 'complete';
        return (
          <View key={i} style={styles.historyRow}>
            <View style={[styles.historyDot, { backgroundColor: isComplete ? Semantic.success : Semantic.danger }]} />
            <View style={styles.historyInfo}>
              <Text style={styles.historyDate}>{b.date}</Text>
              <Text style={styles.historySize}>{b.size}</Text>
            </View>
            <View style={[styles.historyBadge, { backgroundColor: isComplete ? Semantic.successSoft : Semantic.dangerSoft }]}>
              <Text style={[styles.historyBadgeText, { color: isComplete ? Semantic.success : Semantic.danger }]}>
                {t(isComplete ? 'backup.complete' : 'backup.failed')}
              </Text>
            </View>
          </View>
        );
      })}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },

  /* Status card */
  statusCard: {
    backgroundColor: c.card,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: Spacing.xl,
    ...Shadows.sm,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  statusIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Semantic.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  statusInfo: {},
  statusTitle: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: c.text,
  },
  statusDate: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: c.textTertiary,
    marginTop: 2,
  },
  statusMeta: {
    flexDirection: 'row',
    marginBottom: Spacing.lg,
    gap: Spacing.xl,
  },
  metaItem: {},
  metaLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: Grey[400],
  },
  metaValue: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: c.text,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radii.pill,
    marginTop: 2,
  },
  statusBadgeText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
  },

  /* Settings card */
  settingsCard: {
    backgroundColor: c.card,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: Spacing.xl,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  settingTitle: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    fontWeight: FontWeight.medium,
    color: c.text,
  },
  settingDesc: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: c.textTertiary,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: c.backgroundSecondary,
    marginVertical: Spacing.sm,
  },

  /* History */
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.card,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: Spacing.sm,
  },
  historyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.md,
  },
  historyInfo: { flex: 1 },
  historyDate: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: c.text,
  },
  historySize: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    color: c.textTertiary,
    marginTop: 2,
  },
  historyBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radii.pill,
  },
  historyBadgeText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
  },
});
