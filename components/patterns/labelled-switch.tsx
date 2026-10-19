/**
 * LabelledSwitch — an InkSwitch with its words shown beside it.
 *
 * InkSwitch's `label` only reaches a screen reader, so on its own a switch was
 * a bare pill nobody could read. The words here are the same label, shown, and
 * tapping them flips the switch as tapping the pill does. They are hidden from
 * the screen reader so the label is not read twice; the switch itself carries
 * it.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { InkSwitch, InkText } from '@jarida/ink/native';

import { Spacing } from '@/constants/spacing';

export interface LabelledSwitchProps {
  /** What the switch controls or is set to, such as "Keep forever" or "Paused". */
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function LabelledSwitch({ label, checked, onChange }: LabelledSwitchProps) {
  return (
    <View style={styles.row}>
      <InkSwitch label={label} checked={checked} onChange={onChange} />
      <Pressable
        onPress={() => onChange(!checked)}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.words}
      >
        <InkText size="sm" tone="secondary">{label}</InkText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  words: { flexShrink: 1 },
});
