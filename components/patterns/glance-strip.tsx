/**
 * GlanceStrip — the figures Home can state in one row, in place of the badge pair.
 *
 * A figure with no answer behind it is left out rather than drawn as a dash: the row says only
 * what the Pond actually reported, and hides entirely when it reported none of it. That is the
 * same rule the cards below it follow.
 *
 * The temperature names its place because the Pond's weather is wherever the Pond is configured
 * to be, which is not always where the reader is. There is no high and low: `GET /weather`
 * answers one temperature, and the forecast reaches the phone only as a chat tool result.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkText } from '@jarida/ink/native';

import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

export interface Figure {
  key: string;
  value: string;
  label: string;
}

export function GlanceStrip({ figures }: { figures: Figure[] }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();

  if (figures.length === 0) return null;

  return (
    <View style={styles.strip} accessibilityRole="summary" accessibilityLabel={t('home.rightNowTitle')}>
      {figures.map((figure) => (
        <View key={figure.key} style={styles.figure}>
          <InkText size="lg" weight="semibold">{figure.value}</InkText>
          <InkText size="sm" tone="tertiary" numberOfLines={1}>{figure.label}</InkText>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    strip: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    // Equal widths, so three figures read as one row of three rather than as a ragged line.
    figure: {
      flex: 1,
      gap: 2,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: 12,
      backgroundColor: c.backgroundSecondary,
    },
  });
