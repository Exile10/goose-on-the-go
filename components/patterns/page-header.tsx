/**
 * PageHeader — screen title with optional action slot.
 * Matches the desktop's .page-header component.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Grey } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

interface PageHeaderProps {
  title: string;
  action?: React.ReactNode;
}

export const PageHeader = React.memo(function PageHeader({ title, action }: PageHeaderProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {action && <View style={styles.action}>{action}</View>}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.lg,
    marginBottom: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Grey[200],
  },
  title: {
    fontFamily: FontFamily.heading,
    fontWeight: FontWeight.bold,
    fontSize: FontSize.md,
    color: '#1C1C1C',
    letterSpacing: -0.005,
  },
  action: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
});
