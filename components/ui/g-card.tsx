/**
 * GCard — Surface container with optional elevation.
 *
 * @example
 *   <GCard variant="elevated">
 *     <Text>Content here</Text>
 *   </GCard>
 */

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Brand, Grey } from '@/constants/colors';
import { Radii } from '@/constants/radii';
import { Shadows } from '@/constants/shadows';

export type GCardVariant = 'default' | 'elevated';

export interface GCardProps {
  children: React.ReactNode;
  variant?: GCardVariant;
  style?: StyleProp<ViewStyle>;
}

export function GCard({ children, variant = 'default', style }: GCardProps) {
  return (
    <View
      style={[
        styles.card,
        variant === 'elevated' && Shadows.sm,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Brand.white,
    borderWidth: 1,
    borderColor: Grey[200],
    borderRadius: Radii.lg,
  },
});
