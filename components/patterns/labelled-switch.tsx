/**
 * LabelledSwitch — an InkSwitch with its words shown beside it, set small and
 * secondary so a switch inside a form reads as an option rather than a field.
 *
 * Ink draws the words as part of the switch's own target, so tapping them flips
 * it and a screen reader hears the label once, from the switch.
 */

import React from 'react';
import { InkSwitch, InkText } from '@jarida/ink/native';

export interface LabelledSwitchProps {
  /** What the switch controls or is set to, such as "Keep forever" or "Paused". */
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function LabelledSwitch({ label, checked, onChange }: LabelledSwitchProps) {
  return (
    <InkSwitch label={label} checked={checked} onChange={onChange}>
      <InkText size="sm" tone="secondary" style={{ flexShrink: 1 }}>
        {label}
      </InkText>
    </InkSwitch>
  );
}
