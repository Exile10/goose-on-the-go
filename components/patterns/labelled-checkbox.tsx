/**
 * LabelledCheckbox — an InkCheckbox with its words shown beside it.
 *
 * InkCheckbox's `label` only reaches a screen reader, so a list of them was a
 * column of empty boxes with nothing to say which was which. The words here are
 * the same label, shown, and tapping them ticks the box as tapping the box
 * does. They are hidden from the screen reader so the label is not read twice;
 * the checkbox itself carries it.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { InkCheckbox, InkText } from '@jarida/ink/native';

import { Spacing } from '@/constants/spacing';

export interface LabelledCheckboxProps {
  /** What ticking the box chooses, such as a device's name. */
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function LabelledCheckbox({ label, checked, onChange }: LabelledCheckboxProps) {
  return (
    <View style={styles.row}>
      <InkCheckbox label={label} checked={checked} onChange={onChange} />
      <Pressable
        onPress={() => onChange(!checked)}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.words}
      >
        <InkText>{label}</InkText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  words: { flexShrink: 1 },
});
