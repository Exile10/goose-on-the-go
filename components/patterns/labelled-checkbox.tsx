/**
 * LabelledCheckbox — an InkCheckbox with its words shown beside it.
 *
 * Ink draws the words as part of the checkbox's own target, so tapping them
 * ticks the box and a screen reader hears the label once, from the checkbox.
 */

import React from 'react';
import { InkCheckbox, InkText } from '@/components/ui/ink';

export interface LabelledCheckboxProps {
  /** What ticking the box chooses, such as a device's name. */
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function LabelledCheckbox({ label, checked, onChange }: LabelledCheckboxProps) {
  return (
    <InkCheckbox label={label} checked={checked} onChange={onChange}>
      <InkText style={{ flexShrink: 1 }}>{label}</InkText>
    </InkCheckbox>
  );
}
