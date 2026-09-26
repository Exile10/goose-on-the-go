/**
 * ServerStatus — connection indicator dot + label.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FontFamily, FontSize } from '@/constants/typography';
import { Grey, Semantic } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import i18n from '@/services/i18n';

interface ServerStatusProps {
  online: boolean;
  label?: string;
}

export const ServerStatus = React.memo(function ServerStatus({ online, label }: ServerStatusProps) {
  return (
    <View style={styles.container}>
      <View style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]} />
      <Text style={styles.label}>{label ?? (online ? i18n.t('connection.connected') : i18n.t('connection.offline'))}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotOnline: {
    backgroundColor: Semantic.success,
  },
  dotOffline: {
    backgroundColor: Grey[400],
  },
  label: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: Grey[600],
  },
});
