/**
 * QuickAction — dashboard action row.
 */

import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { InkIcon } from '@jarida/ink/native';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Grey, JaridaPurple } from '@/constants/colors';
import { Radii } from '@/constants/radii';
import { Spacing } from '@/constants/spacing';

interface QuickActionProps {
  label: string;
  onPress: () => void;
}

export const QuickAction = React.memo(function QuickAction({ label, onPress }: QuickActionProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={styles.icon}>
        <InkIcon name="sparkle" size={12} tone="neutral" />
      </View>
      <Text style={styles.label}>{label}</Text>
      <InkIcon name="chevron" size={14} tone="neutral" />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pressed: {
    backgroundColor: JaridaPurple[50],
    borderColor: JaridaPurple[100],
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: Radii.sm,
    backgroundColor: Grey[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: '#1C1C1C',
  },
});
