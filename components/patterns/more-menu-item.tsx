/**
 * MoreMenuItem — navigation row for the More hub screen.
 */

import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { InkIcon } from '@jarida/ink/native';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Grey, JaridaPurple } from '@/constants/colors';
import { Radii } from '@/constants/radii';
import { Spacing } from '@/constants/spacing';

interface MoreMenuItemProps {
  label: string;
  onPress: () => void;
}

export const MoreMenuItem = React.memo(function MoreMenuItem({ label, onPress }: MoreMenuItemProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Text style={styles.label}>{label}</Text>
      <InkIcon name="chevron" size={16} tone="neutral" />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radii.sm,
  },
  pressed: {
    backgroundColor: JaridaPurple[50],
  },
  label: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    fontWeight: FontWeight.medium,
    color: '#1C1C1C',
  },
});
