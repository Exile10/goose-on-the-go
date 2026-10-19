/**
 * LabelledSwitch — an InkSwitch that says what it is set to beside it.
 *
 * InkSwitch's `label` only reaches a screen reader, so on its own a switch on a
 * schedule or an automation was a bare pill nobody could read. The words here
 * are the same label, shown, and hidden from the screen reader so it is not
 * read twice.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { InkSwitch, InkText } from '@jarida/ink/native';

import { Spacing } from '@/constants/spacing';

export interface LabelledSwitchProps {
  /** What the switch is set to now, such as "On" or "Paused". */
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function LabelledSwitch({ label, checked, onChange }: LabelledSwitchProps) {
  return (
    <View style={styles.row}>
      <InkSwitch label={label} checked={checked} onChange={onChange} />
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <InkText size="sm" tone="secondary">{label}</InkText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
