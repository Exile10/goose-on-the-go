/**
 * The bars a music widget shows while a track plays: each rises and falls at its own pace, so the
 * row reads as a level meter and says "playing" at a glance.
 *
 * They used to be drawn once at fixed heights, identical whether a song had just started or had
 * been playing for ten minutes. The motion is decorative -- the Pond reports what is playing, not
 * its audio levels -- so the only obligations are to look alive and to cost nothing when nobody
 * is looking:
 *
 * - it runs on the UI thread (Reanimated), so it keeps its rhythm while the JS thread is polling;
 * - it animates only while its screen is focused, because tab screens stay mounted and an
 *   off-screen animation spends battery for nobody;
 * - it honours the system Reduce Motion setting and holds still for anyone who has turned it on.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { equalizerMotion } from './equalizer-motion';

function Bar({ index, height, color, animate }: { index: number; height: number; color: string; animate: boolean }) {
  const motion = equalizerMotion(index);
  const scale = useSharedValue(motion.rest);

  useEffect(() => {
    if (!animate) {
      cancelAnimation(scale);
      scale.set(withTiming(motion.rest, { duration: 200 }));
      return;
    }
    const swing = { duration: motion.period, easing: Easing.inOut(Easing.quad) };
    scale.set(
      withDelay(
        motion.delay,
        withRepeat(withSequence(withTiming(motion.high, swing), withTiming(motion.low, swing)), -1, false),
      ),
    );
    return () => cancelAnimation(scale);
  }, [animate, motion.delay, motion.high, motion.low, motion.period, motion.rest, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: scale.get() }] }));

  return <Animated.View style={[styles.bar, { height, backgroundColor: color }, style]} />;
}

export function EqualizerBars({ count = 8, height = 20, color }: { count?: number; height?: number; color: string }) {
  const reduceMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const animate = focused && !reduceMotion;
  return (
    <View style={[styles.row, { height }]}>
      {Array.from({ length: count }, (_, i) => (
        <Bar key={i} index={i} height={height} color={color} animate={animate} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  // Scaled from the bottom edge, as a level meter grows, not from its middle.
  bar: { width: 4, borderRadius: 2, transformOrigin: 'bottom' },
});
