/**
 * GSkeleton — Pulsing placeholder for loading states.
 *
 * Uses react-native-reanimated to drive a continuous opacity pulse
 * animation on a grey rectangle.
 *
 * @example
 *   <GSkeleton width={200} height={16} borderRadius={Radii.sm} />
 */

import React, { useEffect } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { Grey } from '@/constants/colors';
import { Radii } from '@/constants/radii';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GSkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function GSkeletonInner({
  width = '100%',
  height = 16,
  borderRadius = Radii.sm,
  style,
}: GSkeletonProps) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.4, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.base,
        { width: width as number, height, borderRadius },
        animatedStyle,
        style,
      ]}
    />
  );
}

export const GSkeleton = React.memo(GSkeletonInner);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  base: {
    backgroundColor: Grey[200],
  },
});
