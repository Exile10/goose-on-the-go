/**
 * GSheetBody — the keyboard-aware body of a bottom `InkSheet`, as tall as its
 * content and no taller than a share of the window.
 *
 * A bottom `InkSheet` has no height of its own: its card is as tall as what it
 * holds. `GKeyboardView` is built for screens and fills its parent with
 * `flex: 1`, which in Yoga is a flex basis of zero that then grows into the
 * parent's free space. Inside the sheet there is no free space to grow into,
 * so a `GKeyboardView` there was laid out at zero height and the sheet opened
 * as its title alone, every field and button inside it collapsed to nothing.
 *
 * This takes the fill back off (`flex: 0`), so the body sizes to its content,
 * and caps it with `maxHeight`. The cap includes the keyboard's padding, so
 * with the keyboard up the `ScrollView` inside shrinks to what is left rather
 * than the sheet growing off the top of the window. Put the form in a
 * `ScrollView` as the child; it is what scrolls once the cap is reached.
 *
 * @example
 *   <InkSheet open={open} onClose={onClose} title={title}>
 *     <GSheetBody>
 *       <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
 *         ...
 *       </ScrollView>
 *     </GSheetBody>
 *   </InkSheet>
 */

import React from 'react';
import { useWindowDimensions } from 'react-native';

import { GKeyboardView } from './g-keyboard-view';

/** The share of the window height a sheet body takes at most, by default. */
export const SHEET_BODY_MAX_HEIGHT_RATIO = 0.7;

export interface GSheetBodyProps {
  children: React.ReactNode;
  /** The share of the window height the body may take, keyboard included. */
  maxHeightRatio?: number;
}

export function GSheetBody({ children, maxHeightRatio = SHEET_BODY_MAX_HEIGHT_RATIO }: GSheetBodyProps) {
  const { height } = useWindowDimensions();

  return <GKeyboardView style={{ flex: 0, maxHeight: height * maxHeightRatio }}>{children}</GKeyboardView>;
}
