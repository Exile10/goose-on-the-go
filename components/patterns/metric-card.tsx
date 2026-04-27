/**
 * MetricCard — small stat display (label + value).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Grey } from '@/constants/colors';
import { Radii } from '@/constants/radii';
import { Spacing } from '@/constants/spacing';

interface MetricCardProps {
  label: string;
  value: string;
  trend?: 'ok' | 'warn' | '+';
}

const trendColors = {
  ok: '#1F8A3C',
  warn: '#C88A00',
  '+': '#1C1C1C',
};

export const MetricCard = React.memo(function MetricCard({ label, value, trend }: MetricCardProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, trend && { color: trendColors[trend] }]}>{value}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.sm,
    borderRadius: Radii.md,
    backgroundColor: Grey[50],
  },
  label: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Grey[500],
    letterSpacing: 0.08,
    textTransform: 'uppercase',
  },
  value: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: '#1C1C1C',
    marginTop: 2,
  },
});
