/**
 * A press that answers on the way down.
 *
 * React Native's `Pressable` exposes a `pressed` flag and applies nothing by
 * default, so every hand-rolled tappable in this app was silent until whatever
 * it did finished — a navigation, a fetch, a toggle. Ink's own controls have
 * never behaved that way: `InkCard`, `InkRow` and `InkButton` take the press on
 * `onPressIn` and depress their plate. The two sat side by side on the same
 * screen, one alive under the thumb and one dead, which is the inconsistency
 * this exists to remove rather than any single missing highlight.
 *
 * Two responses, because a press lands on two different kinds of thing:
 *
 *     tint   flat content — a row, a link, a glyph. Ink's own `pressed`
 *            wash goes behind it.
 *     lift   a surface that paints its own opaque face. A wash behind that
 *            is a wash nobody sees, so the whole thing gives instead.
 *
 * Reduced motion turns `lift` into a dim. Losing the response entirely is the
 * wrong reading of the setting: an opacity change is not the vestibular
 * problem, and a control that stops answering is a worse outcome than one that
 * answers without moving.
 *
 * It answers under the thumb as well: a press gives the `haptic` feel, a tap unless the press
 * selects (`selection`), flips something (`toggle`) or must stay silent (`none`). Ink's own
 * controls feel the same through `components/ui/ink.tsx`, so a handler here needs no `tap()`.
 */

import React from 'react';
// The one place a raw Pressable is allowed: the lint rule sends every other press here.
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useInkTheme, useReduceMotion } from '@/components/ui/ink';
import { selectionTick, tap, toggle } from '@/services/haptics';

const FEELS = { tap, selection: selectionTick, toggle } as const;

export interface GPressableProps extends PressableProps {
  /** `lift` for anything that paints its own face; `tint` for the rest; `none` where the press
   *  styles itself (`style` as a function of `pressed`). */
  feedback?: 'tint' | 'lift' | 'none';
  /** How a press feels in the hand: `tap` by default, `none` for a press that must stay silent. */
  haptic?: keyof typeof FEELS | 'none';
}

export function GPressable({ feedback = 'tint', haptic = 'tap', style, children, onPress, ...rest }: GPressableProps) {
  const theme = useInkTheme();
  const reduced = useReduceMotion();

  return (
    <Pressable
      {...rest}
      onPress={
        onPress && haptic !== 'none'
          ? (e: GestureResponderEvent) => {
              // After the handler, so a feel it gives itself is the one felt.
              onPress(e);
              void FEELS[haptic]();
            }
          : onPress
      }
      style={(state) => {
        const base = (typeof style === 'function' ? style(state) : style) as StyleProp<ViewStyle>;
        if (!state.pressed || feedback === 'none') return base;
        const response: ViewStyle =
          feedback === 'lift'
            ? reduced
              ? { opacity: 0.7 }
              : { transform: [{ scale: 0.97 }] }
            : { backgroundColor: theme.color.pressed };
        return [base, response];
      }}
    >
      {children}
    </Pressable>
  );
}
