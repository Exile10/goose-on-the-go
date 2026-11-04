/**
 * GKeyboardView — keeps the focused input, and the button under it, above the
 * on-screen keyboard.
 *
 * The app declares `android:windowSoftInputMode="adjustResize"`, which used to
 * be enough: Android shrank the window and a centred layout re-centred itself
 * in what was left. Edge-to-edge changes that. The window now spans the whole
 * display and is never resized for the keyboard, so the keyboard is drawn over
 * the layout and whatever sits at the focus point disappears behind it — on the
 * pairing wizard, that was the code field and the Continue button both.
 *
 * `KeyboardAvoidingView` is the obvious answer and it is not enough here. Under
 * edge-to-edge it reserved less than the keyboard's real height on the test
 * handset, which lifted the field into view but left the button below it still
 * clipped. So the height is measured from the keyboard event itself, which
 * reports screen coordinates and therefore already accounts for the navigation
 * bar this container also extends behind.
 *
 * Lifting the container is half of it. A scrolling page inside it only gets
 * shorter, and a field that sat low on the page before the keyboard came up is
 * then below the shortened page's bottom edge, with nothing bringing it back:
 * Settings > Memory's number fields were. `GKeyboardScrollView` is the page that
 * does bring it back, and `useFocusedInputReveal` is the same behaviour for a
 * scroller that cannot be one, such as a `FlatList`, or a scroller that shares
 * its `GKeyboardView` with something else.
 *
 * @example
 *   <GKeyboardScrollView contentContainerStyle={styles.scroll}>...</GKeyboardScrollView>
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Spacing } from '@/constants/spacing';

/**
 * Room left between a revealed field and the top of the keyboard, so the field's
 * own hint, or the button under it, is not flush against the keys.
 */
export const REVEAL_MARGIN = Spacing.xl;

// iOS reports `will*` ahead of the animation, so the layout moves with the
// keyboard rather than after it. Android only emits `did*`.
const SHOW_EVENT = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE_EVENT = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

/**
 * The keyboard's height while it is up, and 0 while it is down.
 *
 * `onShow` runs on every show event, and is told whether the keyboard was
 * already up: moving focus from one field to the next re-announces the same
 * keyboard, which changes no layout, so nothing that only watches the height
 * would hear about it.
 */
export function useKeyboardHeight(onShow?: (wasUp: boolean) => void): number {
  const [height, setHeight] = useState(0);
  const up = useRef(false);
  const onShowRef = useRef(onShow);
  useEffect(() => {
    onShowRef.current = onShow;
  }, [onShow]);

  useEffect(() => {
    const show = Keyboard.addListener(SHOW_EVENT, (e) => {
      const wasUp = up.current;
      up.current = true;
      setHeight(e.endCoordinates.height);
      onShowRef.current?.(wasUp);
    });
    const hide = Keyboard.addListener(HIDE_EVENT, () => {
      up.current = false;
      setHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}

export interface GKeyboardViewProps {
  children: React.ReactNode;
  /** Extra space between the keyboard and the content above it. */
  offset?: number;
  style?: StyleProp<ViewStyle>;
}

export function GKeyboardView({ children, offset = 0, style }: GKeyboardViewProps) {
  const keyboard = useKeyboardHeight();
  return (
    <View
      style={[styles.fill, style, keyboard > 0 && { paddingBottom: keyboard + offset }]}
    >
      {children}
    </View>
  );
}

/** What `useFocusedInputReveal` hands to the scroller it manages. */
export interface FocusedInputRevealProps {
  onLayout: (e: LayoutChangeEvent) => void;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle: number;
  keyboardShouldPersistTaps: 'handled';
}

/**
 * Scrolls the focused text field up into the visible part of a scroller while
 * the keyboard is up. Spread the result onto the scroller; the scroller must sit
 * inside a `GKeyboardView`, which is what makes room to scroll into.
 *
 * It reveals at two moments: when the scroller's height changes with the
 * keyboard up (the `GKeyboardView` around it has just shrunk it, and only now is
 * there room to scroll into), and on a show event while the keyboard was already
 * up (focus moved between fields, and no layout will change). It only scrolls
 * down, and only when the field's bottom is below the scroller's: a field
 * already in view, or one in another surface such as a sheet above the
 * keyboard, is left alone.
 *
 * Both positions come from `measureInWindow`, so neither the navigation bar nor
 * a header above the scroller has to be accounted for by hand.
 *
 * @param scroller Reads the scroller's `ScrollView` instance, and is read only
 *   when a reveal runs; for a `FlatList`, its `getNativeScrollRef()`.
 */
export function useFocusedInputReveal(
  scroller: () => ScrollView | null | undefined,
): FocusedInputRevealProps {
  const offset = useRef(0);
  const height = useRef(0);

  const reveal = useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput();
    const scroll = scroller();
    const host = scroll?.getNativeScrollRef();
    if (!input || !scroll || !host) return;
    host.measureInWindow((_x, top, _width, visible) => {
      input.measureInWindow((_fieldX, fieldTop, _fieldWidth, fieldHeight) => {
        const overflow = fieldTop + fieldHeight + REVEAL_MARGIN - (top + visible);
        if (fieldTop < top || overflow <= 0) return;
        scroll.scrollTo({ y: offset.current + overflow, animated: true });
      });
    });
  }, [scroller]);

  const keyboard = useKeyboardHeight(
    useCallback((wasUp: boolean) => {
      if (wasUp) reveal();
    }, [reveal]),
  );

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const next = e.nativeEvent.layout.height;
      const changed = next !== height.current;
      height.current = next;
      if (changed && keyboard > 0) reveal();
    },
    [reveal, keyboard],
  );

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
  }, []);

  return { onLayout, onScroll, scrollEventThrottle: 16, keyboardShouldPersistTaps: 'handled' };
}

export interface GKeyboardScrollViewProps
  extends Omit<ScrollViewProps, keyof FocusedInputRevealProps> {
  children: React.ReactNode;
  /** The outer view's style: the one lifted clear of the keyboard. */
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * The scrolling page for any screen with a text field: lifted clear of the
 * keyboard by `GKeyboardView`, and scrolled so the field being typed in sits
 * above it. Taps on the page's buttons land while the keyboard is up.
 */
export function GKeyboardScrollView({ children, containerStyle, ...scrollProps }: GKeyboardScrollViewProps) {
  const ref = useRef<ScrollView>(null);
  const reveal = useFocusedInputReveal(() => ref.current);
  return (
    <GKeyboardView style={containerStyle}>
      <ScrollView ref={ref} {...scrollProps} {...reveal}>
        {children}
      </ScrollView>
    </GKeyboardView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
