/**
 * The goose on a small pond beside Goose's thinking: rings spread from under it and fade, one after
 * another, on water seen at a slant, and the goose bobs on them, so the line reads as alive without a
 * spinner. All of it runs on the native driver from one looping value, each ring a third of a cycle
 * behind the last. The goose is drawn once, at rest, and moves as a whole: redrawing the bird every
 * frame, as the large goose does, cost the thread's scrolling while the reply streamed. Done, the
 * water holds still with two rings on it and the goose rests there, plain SVG drawn once.
 */

import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useInkTheme, useReduceMotion } from '@jarida/ink/native';

import { GooseStill } from '@/components/patterns/goose';

const WIDTH = 40;
/** The water seen at a slant: rings are ellipses this much flatter than they are wide. */
const SLANT = 0.36;
const WATER = Math.round(WIDTH * SLANT);
/** The goose rides a little narrower than its pond, so the rings show beyond it on both sides. */
const BIRD = 26;
const HEIGHT = 30;
const RINGS = 3;
const CYCLE_MS = 2600;
/** Where the rings sit when the water is still. */
const AT_REST = [0.5, 0.9];

/** Ring `i` of `RINGS`: the shared clock, shifted by its share of a cycle and wrapped round. */
function ringProgress(clock: Animated.Value, i: number): Animated.AnimatedInterpolation<number> {
  const offset = i / RINGS;
  if (offset === 0) return clock.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  return clock.interpolate({
    inputRange: [0, 1 - offset, 1 - offset + 0.0001, 1],
    outputRange: [offset, 1, 0, offset],
  });
}

function Ring({ progress, color }: { progress: Animated.AnimatedInterpolation<number> | Animated.Value; color: string }) {
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  return (
    <Animated.View
      style={[
        styles.ring,
        {
          borderColor: color,
          opacity: progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.9, 0] }),
          transform: [{ scaleX: scale }, { scaleY: Animated.multiply(scale, SLANT) }],
        },
      ]}
    />
  );
}

export function PondRipple({ live }: { live: boolean }) {
  const theme = useInkTheme();
  const reduced = useReduceMotion();
  const [clock] = useState(() => new Animated.Value(0));
  const moving = live && !reduced;

  useEffect(() => {
    if (!moving) return;
    clock.setValue(0);
    const loop = Animated.loop(
      Animated.timing(clock, { toValue: 1, duration: CYCLE_MS, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [clock, moving]);

  // Twice a cycle: down as each ring leaves it, up between, and rocking a little on the swell.
  const bob = {
    transform: [
      { translateY: clock.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, 1.2, 0, 1.2, 0] }) },
      { rotate: clock.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-3deg', '3deg', '-3deg'] }) },
    ],
  };
  const ink = theme.color.accentLine;
  return (
    <View style={styles.pond} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.water}>
        <View style={[styles.surface, { backgroundColor: theme.color.accentSofter }]} />
        {moving
          ? Array.from({ length: RINGS }, (_, i) => <Ring key={i} progress={ringProgress(clock, i)} color={ink} />)
          : AT_REST.map((at) => <Ring key={at} progress={new Animated.Value(at)} color={ink} />)}
      </View>
      <Animated.View style={[styles.bird, moving ? bob : null]}>
        <GooseStill state={live ? 'working' : 'idle'} size={BIRD} water={false} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  pond: { width: WIDTH, height: HEIGHT },
  water: { position: 'absolute', left: 0, right: 0, bottom: 0, height: WATER, alignItems: 'center', justifyContent: 'center' },
  surface: { position: 'absolute', width: WIDTH, height: WATER, borderRadius: WIDTH / 2 },
  ring: { position: 'absolute', width: WIDTH, height: WIDTH, borderRadius: WIDTH / 2, borderWidth: 1.5 },
  // Its waterline on the middle of the water, where the rings start.
  bird: { position: 'absolute', left: (WIDTH - BIRD) / 2, bottom: Math.round(WATER / 2) - 2 },
});
