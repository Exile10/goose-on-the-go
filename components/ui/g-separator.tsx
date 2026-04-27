/**
 * GSeparator — Horizontal divider line.
 *
 * @example
 *   <GSeparator />
 */

import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Grey } from '@/constants/colors';

export interface GSeparatorProps {
  style?: ViewStyle;
}

function GSeparatorInner({ style }: GSeparatorProps) {
  return <View style={[styles.separator, style]} />;
}

export const GSeparator = React.memo(GSeparatorInner);

const styles = StyleSheet.create({
  separator: {
    height: 1,
    width: '100%',
    backgroundColor: Grey[200],
  },
});
