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
 * @example
 *   <GKeyboardView style={styles.container}>...</GKeyboardView>
 */

import React, { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, View, type ViewStyle } from 'react-native';

export interface GKeyboardViewProps {
  children: React.ReactNode;
  /** Extra space between the keyboard and the content above it. */
  offset?: number;
  style?: ViewStyle | ViewStyle[];
}

export function GKeyboardView({ children, offset = 0, style }: GKeyboardViewProps) {
  const [keyboard, setKeyboard] = useState(0);

  useEffect(() => {
    // iOS reports `will*` ahead of the animation, so the layout moves with the
    // keyboard rather than after it. Android only emits `did*`.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) =>
      setKeyboard(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(hideEvent, () => setKeyboard(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <View
      style={[styles.fill, style, keyboard > 0 && { paddingBottom: keyboard + offset }]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
