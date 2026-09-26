/**
 * ChromePill — a worded control floating over content, in the bar's material.
 *
 * `ChromePuck`'s sibling for the rare control whose job no glyph says as
 * plainly as its word: "Done", in the corner, while the wall is being chosen
 * from. Same fill, same `lineStrong` hairline, same lift and the same height,
 * so the one can stand in for the other in place without the corner changing
 * what it is made of. Chrome, so no edge: the plate belongs to the cards.
 */

import React from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { glassLift } from '@jarida/ink';
import { inkText, useInkTheme } from '@jarida/ink/native';

import { PUCK_SIZE } from '@/components/patterns/chrome-puck';
import { GPressable } from '@/components/ui/g-pressable';

export interface ChromePillProps {
  /** Shown, and spoken. */
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export function ChromePill({ label, onPress, style }: ChromePillProps) {
  const theme = useInkTheme();
  const text = inkText(theme, { size: 'md', weight: theme.weight.semibold });

  return (
    <GPressable
      feedback="lift"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.pill,
        {
          paddingHorizontal: theme.space[5],
          backgroundColor: theme.color.chrome,
          borderColor: theme.color.lineStrong,
          borderWidth: theme.edge.hairlineWidth,
        },
        glassLift(theme),
        style,
      ]}
    >
      <Text style={text.style}>{label}</Text>
    </GPressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: PUCK_SIZE,
    borderRadius: PUCK_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
