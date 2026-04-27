/**
 * ScreenFlatList — FlatList-based screen wrapper with SafeAreaView.
 *
 * Provides consistent horizontal padding and background for list-based
 * screens. Accepts all standard FlatList props.
 *
 * @example
 *   <ScreenFlatList
 *     data={items}
 *     keyExtractor={(item) => item.id}
 *     renderItem={({ item }) => <ItemCard item={item} />}
 *   />
 */

import React from 'react';
import { FlatList, StyleSheet, type FlatListProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Grey } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreenFlatListProps<T> extends FlatListProps<T> {
  /** Override the SafeAreaView style */
  safeAreaStyle?: ViewStyle;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScreenFlatList<T>({
  safeAreaStyle,
  contentContainerStyle,
  ...rest
}: ScreenFlatListProps<T>) {
  return (
    <SafeAreaView style={[styles.safe, safeAreaStyle]}>
      <FlatList<T>
        contentContainerStyle={[styles.content, contentContainerStyle]}
        showsVerticalScrollIndicator={false}
        {...rest}
      />
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
