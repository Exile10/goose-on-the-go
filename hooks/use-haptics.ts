/**
 * useHaptics — typed haptic feedback helpers.
 *
 * Wraps expo-haptics with named methods. Only fires on iOS;
 * returns no-ops on Android and web where haptics are unsupported.
 */

import { useMemo } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

interface HapticActions {
  light: () => void;
  medium: () => void;
  heavy: () => void;
  success: () => void;
  warning: () => void;
  error: () => void;
}

const noop = () => {};

const noopActions: HapticActions = {
  light: noop,
  medium: noop,
  heavy: noop,
  success: noop,
  warning: noop,
  error: noop,
};

const iosActions: HapticActions = {
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};

export function useHaptics(): HapticActions {
  return useMemo(() => (Platform.OS === 'ios' ? iosActions : noopActions), []);
}
