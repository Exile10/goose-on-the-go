/**
 * ScreenScrollView — Standard screen wrapper with SafeAreaView + ScrollView.
 *
 * Provides consistent padding, background color, and safe-area insets
 * for vertically scrollable screen content.
 *
 * @example
 *   <ScreenScrollView>
 *     <Text>Screen content</Text>
 *   </ScreenScrollView>
 */

import React from 'react';
import { ScrollView, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Grey } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreenScrollViewProps {
  children: React.ReactNode;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScreenScrollView({
  children,
  style,
  contentContainerStyle,
}: ScreenScrollViewProps) {
  return (
    <SafeAreaView style={[styles.safe, style]}>
      <ScrollView
        contentContainerStyle={[styles.content, contentContainerStyle]}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Grey[50],
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
});
