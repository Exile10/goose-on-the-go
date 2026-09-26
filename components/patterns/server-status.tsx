/**
 * ServerStatus — whether the Pond is reachable, as a dot and a word.
 *
 * The caller may name the state itself; without a label this falls back to the
 * catalogue rather than to an English literal.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useThemedStyles } from '@/hooks/use-themed-styles';
import { Semantic } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { FontFamily, FontSize } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';

interface ServerStatusProps {
  online: boolean;
  label?: string;
}

export const ServerStatus = React.memo(function ServerStatus({
  online,
  label,
}: ServerStatusProps) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <View style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]} />
      <Text style={styles.label}>
        {label ?? t(online ? 'pond.connected' : 'pond.unreachable')}
      </Text>
    </View>
  );
});

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    dotOnline: { backgroundColor: Semantic.success },
    dotOffline: { backgroundColor: c.textTertiary },
    label: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.xs,
      color: c.textSecondary,
    },
  });
