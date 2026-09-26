/**
 * RestoreScreen — Backup selection, transfer progress, completion.
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { InkButton, InkTitle } from '@jarida/ink/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Grey, JaridaPurple, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';

type RestoreState = 'select' | 'progress' | 'complete';

interface BackupItem {
  id: string;
  date: string;
  size: string;
  devices: number;
  rooms: number;
}

const BACKUPS: BackupItem[] = [
  { id: '1', date: 'Apr 26, 2026', size: '142 MB', devices: 6, rooms: 4 },
  { id: '2', date: 'Apr 19, 2026', size: '138 MB', devices: 6, rooms: 4 },
  { id: '3', date: 'Apr 12, 2026', size: '135 MB', devices: 5, rooms: 3 },
];

export default function RestoreScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const [state, setState] = useState<RestoreState>('select');
  const [selectedBackup, setSelectedBackup] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const handleRestore = useCallback(() => {
    if (!selectedBackup) return;
    setState('progress');
    setProgress(0);

    // Simulate progress
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setState('complete');
          return 100;
        }
        return prev + 5;
      });
    }, 200);
  }, [selectedBackup]);

  const handleDone = useCallback(() => {
    setState('select');
    setSelectedBackup(null);
    setProgress(0);
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {state === 'select' && (
        <>
          {/* Info */}
          <View style={styles.infoBanner}>
            <GIcon name="refresh" size={18} color={JaridaPurple[600]} />
            <Text style={styles.infoText}>
              Restore your Pond device from a previous backup. This will replace current settings, memories, and device configurations.
            </Text>
          </View>

          {/* Backup selection */}
          <InkTitle level={3}>{t('sections.chooseBackup')}</InkTitle>
          {BACKUPS.map((b) => (
            <GPressable feedback="lift"
              key={b.id}
              style={[styles.backupCard, selectedBackup === b.id && styles.backupCardSelected]}
              onPress={() => setSelectedBackup(b.id)}
            >
              <View style={styles.backupHeader}>
                <View style={styles.radioOuter}>
                  {selectedBackup === b.id && <View style={styles.radioInner} />}
                </View>
                <View style={styles.backupInfo}>
                  <Text style={styles.backupDate}>{b.date}</Text>
                  <Text style={styles.backupSize}>{b.size}</Text>
                </View>
              </View>
              <View style={styles.backupMeta}>
                <View style={styles.metaChip}>
                  <Text style={styles.metaText}>{b.devices} {t('profile.devices')}</Text>
                </View>
                <View style={styles.metaChip}>
                  <Text style={styles.metaText}>{b.rooms} {t('profile.rooms')}</Text>
                </View>
              </View>
            </GPressable>
          ))}

          <InkButton variant="primary" onPress={handleRestore} disabled={!selectedBackup}>
            {t('screens.restore')}
          </InkButton>
        </>
      )}

      {state === 'progress' && (
        <View style={styles.progressWrap}>
          <GIcon name="refresh" size={28} color={JaridaPurple[500]} />
          <Text style={styles.progressTitle}>{t('restore.restoring')}</Text>
          <View style={styles.progressBarWrap}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.progressPercent}>{progress}%</Text>
          <View style={styles.progressSteps}>
            <Step done={progress > 20} label={t('restore.settings')} styles={styles} />
            <Step done={progress > 50} label={t('restore.memories')} styles={styles} />
            <Step done={progress > 75} label={t('restore.devices')} styles={styles} />
            <Step done={progress >= 100} label={t('restore.routines')} styles={styles} />
          </View>
        </View>
      )}

      {state === 'complete' && (
        <View style={styles.completeWrap}>
          <GIcon name="sparkle" size={28} color={Semantic.success} />
          <Text style={styles.completeTitle}>{t('restore.done')}</Text>
          <InkButton variant="primary" onPress={handleDone}>
            {t('common.done')}
          </InkButton>
        </View>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

/** One line of the transfer, ticked once its share of the progress has passed. */
function Step({
  done,
  label,
  styles,
}: {
  done: boolean;
  label: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.progressStepRow}>
      {done ? (
        <GIcon name="check" size={12} color={Semantic.success} />
      ) : (
        <View style={styles.progressStepPending} />
      )}
      <Text style={[styles.progressStep, done && styles.progressStepDone]}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },

    /* Info banner */
    infoBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: c.tintSoft,
      borderRadius: Radii.xl,
      padding: Spacing.lg,
      gap: Spacing.md,
      marginBottom: Spacing.xl,
    },
    infoText: {
      flex: 1,
      fontFamily: FontFamily.body,
      fontSize: FontSize.sm,
      color: c.text,
      lineHeight: FontSize.sm * 1.5,
    },

    /* Backup cards */
    backupCard: {
      backgroundColor: c.card,
      borderRadius: Radii.xl,
      padding: Spacing.lg,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: Spacing.md,
    },
    backupCardSelected: {
      borderColor: JaridaPurple[500],
      borderWidth: 2,
      backgroundColor: c.tintSoft,
    },
    backupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    radioOuter: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: c.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: Spacing.md,
    },
    radioInner: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: JaridaPurple[500],
    },
    backupInfo: { flex: 1 },
    backupDate: {
      fontFamily: FontFamily.heading,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: c.text,
    },
    backupSize: {
      fontFamily: FontFamily.mono,
      fontSize: FontSize.sm,
      color: c.textTertiary,
      marginTop: 2,
    },
    backupMeta: {
      flexDirection: 'row',
      gap: Spacing.sm,
      marginTop: Spacing.md,
    },
    metaChip: {
      backgroundColor: c.backgroundSecondary,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: Radii.pill,
    },
    metaText: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.xs,
      color: c.textSecondary,
    },

    /* Progress */
    progressWrap: {
      alignItems: 'center',
      paddingVertical: Spacing['5xl'],
      gap: Spacing.lg,
    },
    progressTitle: {
      fontFamily: FontFamily.heading,
      fontSize: FontSize.xl,
      fontWeight: FontWeight.bold,
      color: c.text,
    },
    progressBarWrap: {
      width: '100%',
      height: 8,
      backgroundColor: c.backgroundSecondary,
      borderRadius: 4,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: JaridaPurple[500],
      borderRadius: 4,
    },
    progressPercent: {
      fontFamily: FontFamily.heading,
      fontSize: FontSize.xl,
      fontWeight: FontWeight.bold,
      color: JaridaPurple[500],
    },
    progressSteps: { gap: Spacing.sm, alignSelf: 'flex-start', width: '100%' },
    progressStepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    progressStepPending: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: c.border,
    },
    progressStep: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.base,
      color: Grey[400],
    },
    progressStepDone: { color: Semantic.success },

    /* Complete */
    completeWrap: {
      alignItems: 'center',
      paddingVertical: Spacing['5xl'],
      gap: Spacing.lg,
    },
    completeTitle: {
      fontFamily: FontFamily.heading,
      fontSize: FontSize.xl,
      fontWeight: FontWeight.bold,
      color: Semantic.success,
    },
  });
