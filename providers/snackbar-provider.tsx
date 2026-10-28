/**
 * SnackbarProvider -- one short message at the foot of the screen about an action the user just
 * took: "Saved on your Pond.", "Could not start the run." with Try again.
 *
 * Mounted once, inside `InkProvider` in `app/_layout.tsx`, so it draws with the app's theme and
 * sits over every screen. The message itself lives in `services/snackbar.ts`; `useSnackbar()` is
 * the hook for components, and a module-level store calls `showSnackbar` directly.
 *
 * What it does, after Material 3's snackbar and the HIG:
 *
 * - One at a time. A new message replaces the one showing.
 * - It goes by itself: about four seconds, longer for a long sentence (Ink's `readingTime`), and
 *   at least eight when it offers an action. With a screen reader on, one that offers an action
 *   stays until it is dismissed or replaced, because finding the button by swiping takes longer
 *   than any timer a sighted reader would accept.
 * - A tap on the message puts it away; so does the screen reader's escape gesture.
 * - It is announced, once, when it appears. Announced rather than a live region, because Android
 *   would otherwise read it twice.
 * - It clears the safe area, the tab bar (which reports its height with `useSnackbarClearance`)
 *   and the keyboard.
 * - It slides and fades in Ink's base duration, and simply appears with Reduce Motion on
 *   (`theme.animate`).
 * - An inverse surface, as Material draws it, and the danger fill for a failure. No border, no
 *   icon: the colour and the sentence say which it is.
 *
 * Which feedback goes here and which stays in the page is in docs/VIEW-LAYER.md, "Feedback for
 * actions".
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AccessibilityInfo, Animated, Easing, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { toneColors } from '@jarida/ink';
import { inkText, readingTime, useInkTheme } from '@jarida/ink/native';

import {
  SNACKBAR_ACTION_MS,
  SNACKBAR_MS,
  currentSnackbar,
  dismissSnackbar,
  showSnackbar,
  subscribeSnackbar,
  type Snackbar,
  type SnackbarRequest,
} from '@/services/snackbar';

/** What `useSnackbar()` hands a component. Both functions are stable. */
export interface SnackbarApi {
  show: (request: SnackbarRequest) => number;
  dismiss: (id?: number) => void;
}

const API: SnackbarApi = { show: showSnackbar, dismiss: dismissSnackbar };

/** Report the bottom chrome's height, so the message sits above it. */
const ClearanceContext = createContext<(height: number) => void>(() => {});

/**
 * How long `snackbar` stays on its own, or null for until it is put away.
 *
 * Exported for the tests, which pin the rule rather than a number in a timer.
 */
export function snackbarDuration(snackbar: Snackbar, screenReader: boolean): number | null {
  if (snackbar.action && screenReader) return null;
  const floor = snackbar.action ? SNACKBAR_ACTION_MS : SNACKBAR_MS;
  return Math.max(floor, readingTime(snackbar.message));
}

export function SnackbarProvider({ children }: PropsWithChildren) {
  const [clearance, setClearance] = useState(0);
  return (
    <ClearanceContext.Provider value={setClearance}>
      {children}
      <SnackbarHost clearance={clearance} />
    </ClearanceContext.Provider>
  );
}

/** Show or put away the snackbar. Works anywhere; the provider only draws it. */
export function useSnackbar(): SnackbarApi {
  return API;
}

/**
 * Keep the snackbar above a bar drawn over the foot of the screen. Pass 0 when the bar is not in
 * front -- the tab bar passes its height only while its navigator is focused, so a stack screen
 * pushed over the tabs gets the plain safe area back.
 */
export function useSnackbarClearance(height: number): void {
  const report = useContext(ClearanceContext);
  useEffect(() => {
    report(height);
    return () => report(0);
  }, [report, height]);
}

function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    // iOS says `will*` ahead of the animation, so the message moves with the keyboard.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

function useScreenReader(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((enabled) => {
        if (live) setOn(enabled);
      })
      .catch(() => {
        // Unknown is treated as off: the message still goes by itself, as it would for anyone.
      });
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setOn);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return on;
}

function SnackbarHost({ clearance }: { clearance: number }) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const screenReader = useScreenReader();
  const snackbar = useSyncExternalStore(subscribeSnackbar, currentSnackbar);

  // The last message stays drawn while it slides away, so it leaves with its words on it. Kept in
  // step while rendering, as the view-models reset theirs, rather than one frame late in an effect.
  const [shown, setShown] = useState<Snackbar | null>(snackbar);
  if (snackbar && snackbar !== shown) setShown(snackbar);
  if (!snackbar && shown && !theme.animate) setShown(null);
  const [progress] = useState(() => new Animated.Value(snackbar ? 1 : 0));

  useEffect(() => {
    if (snackbar) AccessibilityInfo.announceForAccessibility(snackbar.message);
  }, [snackbar]);

  useEffect(() => {
    const target = snackbar ? 1 : 0;
    if (!theme.animate) {
      progress.setValue(target);
      return;
    }
    const run = Animated.timing(progress, {
      toValue: target,
      duration: theme.duration.base,
      easing: Easing.bezier(theme.easing[0], theme.easing[1], theme.easing[2], theme.easing[3]),
      useNativeDriver: true,
    });
    run.start(({ finished }) => {
      if (finished && !snackbar) setShown(null);
    });
    return () => run.stop();
  }, [snackbar, progress, theme.animate, theme.duration.base, theme.easing]);

  useEffect(() => {
    if (!snackbar) return;
    const ms = snackbarDuration(snackbar, screenReader);
    if (ms === null) return;
    const timer = setTimeout(() => dismissSnackbar(snackbar.id), ms);
    return () => clearTimeout(timer);
  }, [snackbar, screenReader]);

  const palette = useMemo(() => {
    const danger = toneColors('danger', theme.color);
    // The inverse of the page: the text colour as the ground, the page colour as the words.
    return {
      ground: { neutral: theme.color.text, danger: danger.solid },
      words: { neutral: theme.color.bg, danger: danger.onSolid },
    };
  }, [theme.color]);

  if (!shown) return null;

  const fg = palette.words[shown.tone];
  const bottom = (keyboard > 0 ? keyboard : clearance > 0 ? clearance : insets.bottom) + theme.space[3];
  const body = inkText(theme, { size: 'sm', color: fg });
  const action = inkText(theme, { size: 'sm', weight: theme.weight.bold, color: fg });

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}>
      <Animated.View
        testID="snackbar"
        style={{
          marginHorizontal: theme.space[4],
          marginBottom: bottom,
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [theme.space[4], 0] }) }],
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[2],
          minHeight: theme.touch.tapMin,
          paddingLeft: theme.space[4],
          paddingRight: shown.action ? theme.space[2] : theme.space[4],
          borderRadius: theme.radius.md,
          backgroundColor: palette.ground[shown.tone],
          // A plane over the content, said by its lift rather than a rule around it.
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 6,
        }}
      >
        <Pressable
          style={{ flex: 1, paddingVertical: theme.space[3] }}
          onPress={() => dismissSnackbar(shown.id)}
          onAccessibilityEscape={() => dismissSnackbar(shown.id)}
          accessibilityLabel={shown.message}
          accessibilityHint={t('common.dismissHint')}
        >
          <Text style={body.style}>{shown.message}</Text>
        </Pressable>
        {shown.action ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              dismissSnackbar(shown.id);
              shown.action?.onPress();
            }}
            hitSlop={theme.space[2]}
            style={{ minHeight: theme.touch.tapMin, justifyContent: 'center', paddingHorizontal: theme.space[3] }}
          >
            <Text style={action.style}>{shown.action.label}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}
