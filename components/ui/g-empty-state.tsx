/**
 * GEmptyState — Centered empty / zero-state display.
 *
 * Shows an icon, title, description, and an optional action slot
 * when a list or view has no content to display.
 *
 * @example
 *   <GEmptyState
 *     icon="search"
 *     title="No results"
 *     message="Try adjusting your search terms."
 *     action={<GButton variant="secondary" onPress={reset}>Clear filters</GButton>}
 *   />
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Grey } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { GIcon } from './g-icon';
import type { IconName } from '@/constants/icons';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GEmptyStateProps {
  icon?: IconName;
  title?: string;
  message: string;
  action?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GEmptyState({ icon, title, message, action }: GEmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon && (
        <GIcon name={icon} size={24} color={Grey[400]} />
      )}
      {title && <Text style={styles.title}>{title}</Text>}
      <Text style={styles.message}>{message}</Text>
      {action && <View style={styles.actionSlot}>{action}</View>}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing['3xl'],
    paddingHorizontal: Spacing.xl,
  },
  title: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Grey[700],
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  message: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[500],
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  actionSlot: {
    marginTop: Spacing.lg,
  },
});
