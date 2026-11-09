/**
 * Ink, as this app uses it: every component of `@jarida/ink/native`, with the ones a person
 * presses giving the feel of what they did. A button or card taps, a choice ticks, a switch or a
 * checkbox toggles. Ink itself has no haptics, so without this each screen had to remember them,
 * and many did not (the Devices tab's add button, the Home avatar, the Ask Goose suggestions).
 *
 * Import Ink from here, never from `@jarida/ink/native` directly; the lint rule enforces it. A
 * handler on one of these components needs no `tap()` of its own.
 */
import {
  InkButton as InkButtonBase,
  InkCard as InkCardBase,
  InkCheckbox as InkCheckboxBase,
  InkChip as InkChipBase,
  InkChoice as InkChoiceBase,
  InkListItem as InkListItemBase,
  InkMenu as InkMenuBase,
  InkRadioGroup as InkRadioGroupBase,
  InkSegmented as InkSegmentedBase,
  InkSelect as InkSelectBase,
  InkSwitch as InkSwitchBase,
  type InkButtonProps,
  type InkCardProps,
  type InkChipProps,
  type InkChoiceProps,
  type InkSegmentedProps,
  type InkSwitchProps,
} from '@jarida/ink/native';
import React, { type ComponentProps } from 'react';

import { selectionTick, tap, toggle } from '@/services/haptics';

// A name this file defines is not re-exported by `export *` (ECMAScript says so, and Babel's
// transform honours it), so the wrapped components below are the ones the app gets. The
// import/export rule does not model that precedence; ink.test.tsx checks it instead.
/* eslint-disable import/export */
export * from '@jarida/ink/native';

/**
 * `handler`, then `feel`: a handler that gives its own feel first keeps it (haptics drops the
 * second within its press window). Undefined stays undefined, so a disabled control stays inert.
 */
export function withFeel<A extends unknown[]>(
  handler: ((...args: A) => void) | undefined,
  feel: () => Promise<void>,
): ((...args: A) => void) | undefined {
  if (!handler) return undefined;
  return (...args: A) => {
    handler(...args);
    void feel();
  };
}

export function InkButton(props: InkButtonProps) {
  return <InkButtonBase {...props} onPress={withFeel(props.onPress, tap)} />;
}

export function InkCard(props: InkCardProps) {
  return <InkCardBase {...props} onPress={withFeel(props.onPress, tap)} />;
}

export function InkChip(props: InkChipProps) {
  return <InkChipBase {...props} onPress={withFeel(props.onPress, selectionTick)} onRemove={withFeel(props.onRemove, tap)} />;
}

export function InkChoice(props: InkChoiceProps) {
  return <InkChoiceBase {...props} onSelect={withFeel(props.onSelect, selectionTick)} />;
}

export function InkSegmented<T extends string>(props: InkSegmentedProps<T>) {
  return <InkSegmentedBase {...props} onChange={withFeel(props.onChange, selectionTick)!} />;
}

export function InkSwitch(props: InkSwitchProps) {
  return <InkSwitchBase {...props} onChange={withFeel(props.onChange, toggle)!} />;
}

export function InkCheckbox(props: ComponentProps<typeof InkCheckboxBase>) {
  return <InkCheckboxBase {...props} onChange={withFeel(props.onChange, toggle)!} />;
}

export function InkListItem(props: ComponentProps<typeof InkListItemBase>) {
  return <InkListItemBase {...props} onPress={withFeel(props.onPress, tap)} />;
}

export function InkSelect<T extends string>(props: ComponentProps<typeof InkSelectBase<T>>) {
  return <InkSelectBase<T> {...props} onChange={withFeel(props.onChange, selectionTick)!} />;
}

export function InkRadioGroup<T extends string>(props: ComponentProps<typeof InkRadioGroupBase<T>>) {
  return <InkRadioGroupBase<T> {...props} onChange={withFeel(props.onChange, selectionTick)!} />;
}

export function InkMenu(props: ComponentProps<typeof InkMenuBase>) {
  const items = props.items.map((item) => ({ ...item, onPress: withFeel(item.onPress, tap) }));
  return <InkMenuBase {...props} items={items} />;
}
