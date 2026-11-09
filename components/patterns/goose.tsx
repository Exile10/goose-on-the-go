/**
 * Goose — the Pond's bird, afloat. A shared illustration, not a decoration.
 *
 * pond-desktop's `<Goose />` (`components/Goose.tsx`, `styles/goose.css`)
 * brought across part for part, for anywhere the app needs the assistant doing
 * something: an empty conversation, a working strip, an empty list. It is drawn
 * from separate pieces — body, tail, wing, neck, head, beak — so the body and
 * the head can move on different phases. A single silhouette can only be
 * translated as a lump, which is what made the desktop's first version read as
 * a sticker rather than a bird.
 *
 * The periods are the stylesheet's, and deliberately not multiples of one
 * another: a 3.6s bob against a 5.2s dip drifts in and out of step instead of
 * locking into a loop the eye can find. Working is the same vocabulary at about
 * twice the tempo, so it reads as the same bird paddling rather than a
 * different animation.
 *
 * Each moving part is its own layer, turned on the native driver about the
 * point the stylesheet's `transform-origin` names. The goose works hardest
 * while the Pond is running, which is when the JS thread is busiest, so nothing
 * here waits on that thread once a loop has begun.
 *
 * Reduced motion stops everything and leaves one ripple standing, as the
 * desktop does. The ripples are the one part whose last frame is not a sensible
 * resting pose: scaled out, and invisible.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { useInkTheme, useReduceMotion } from '@/components/ui/ink';

export type GooseState =
  /** Afloat and waiting. A slow bob, and now and then a dip of the head. */
  | 'idle'
  /** The Pond is running. It paddles and pecks, and the ripples quicken. */
  | 'working';

export interface GooseProps {
  state: GooseState;
  /**
   * Width in points. The height follows the art: three quarters of the width
   * over water, eight ninths without, where the art is cropped to the bird.
   */
  size?: number;
  /**
   * The waterline and its ripples. Off for inline use — a status strip wants
   * the bird, not the pond — and the art crops to the bird to suit, so a small
   * goose does not spend half its box on empty water.
   */
  water?: boolean;
}

interface ArtFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The whole pond, and the crop to the bird a waterless goose uses. */
const POND: ArtFrame = { x: 0, y: 0, width: 160, height: 120 };
const BIRD: ArtFrame = { x: 38, y: 6, width: 108, height: 96 };

/** The stylesheet's `transform-origin`s, in the art's own units. */
const FLOAT_ORIGIN = { x: 80, y: 84 };
const HEAD_ORIGIN = { x: 70, y: 62 };
const RIPPLE_ORIGIN = { x: 80, y: 98 };

/** Each part's period. The second ripple runs half a period behind the first. */
const TEMPO: Record<GooseState, { float: number; head: number; ripple: number }> = {
  idle: { float: 3600, head: 5200, ripple: 3600 },
  working: { float: 1150, head: 1700, ripple: 1500 },
};

type Keyframe = readonly [at: number, value: number];

// goose-bob and goose-paddle. The lift (in the art's units) and the roll (in
// degrees) share one phase, as the two halves of one keyframe block do.
const FLOAT: Record<GooseState, { lift: readonly Keyframe[]; roll: readonly Keyframe[] }> = {
  idle: {
    lift: [[0, 0], [0.5, -4], [1, 0]],
    roll: [[0, 0], [0.5, -1.2], [1, 0]],
  },
  // A forward lean as well as the quicker tempo.
  working: {
    lift: [[0, 0], [0.5, -3], [1, 0]],
    roll: [[0, -1], [0.5, 1.5], [1, -1]],
  },
};

// goose-dip and goose-peck, in degrees.
const HEAD: Record<GooseState, readonly Keyframe[]> = {
  idle: [[0, 0], [0.35, 4], [0.7, -2.5], [1, 0]],
  working: [[0, 0], [0.4, 9], [0.6, 6], [1, 0]],
};

/** Under reduced motion the first ripple stays, at its natural size and faint. */
const RIPPLE_STILL = 0.26;

// CSS's named curves, spelled out: React Native's `Easing.ease` is CSS's
// ease-in, not its `ease-in-out`.
const EASE_IN_OUT = Easing.bezier(0.42, 0, 0.58, 1);
const EASE_OUT = Easing.bezier(0, 0, 0.58, 1);

/** Points sampled along each eased segment: enough that the straight runs between them never show. */
const SAMPLES = 8;

/**
 * A CSS `@keyframes` block, as an interpolation a native loop can drive.
 *
 * CSS eases each segment between two keyframes on its own curve; an
 * interpolation joins its points with straight lines. Sampling each segment's
 * curve puts the ease back, and keeps the whole cycle one `0 → 1` timing that
 * loops on the UI thread. `unit` scales the values, here from the art's units
 * to points.
 */
function keyframes(
  frames: readonly Keyframe[],
  ease: (t: number) => number = EASE_IN_OUT,
  unit = 1,
) {
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  for (let i = 0; i < frames.length - 1; i += 1) {
    const [from, a] = frames[i];
    const [to, b] = frames[i + 1];
    // A hold has nothing to ease.
    const steps = a === b ? 1 : SAMPLES;
    for (let s = 0; s < steps; s += 1) {
      inputRange.push(from + ((to - from) * s) / steps);
      outputRange.push((a + (b - a) * ease(s / steps)) * unit);
    }
  }
  const [end, last] = frames[frames.length - 1];
  inputRange.push(end);
  outputRange.push(last * unit);
  return { inputRange, outputRange };
}

/** The same, for a rotation written in degrees. */
function turn(frames: readonly Keyframe[]) {
  const { inputRange, outputRange } = keyframes(frames);
  return { inputRange, outputRange: outputRange.map((deg) => `${deg}deg`) };
}

/**
 * Created native, so a `setValue` goes straight to the UI thread instead of
 * re-rendering the views it drives.
 */
function native(at: number) {
  return new Animated.Value(at, { useNativeDriver: true });
}

/** Runs `value` from 0 to 1 forever, entirely on the UI thread, and returns the stop. */
function runLoop(value: Animated.Value, duration: number, easing: (t: number) => number = Easing.linear) {
  // A native loop repeats from wherever it started, so it has to start at 0.
  value.setValue(0);
  const loop = Animated.loop(Animated.timing(value, { toValue: 1, duration, easing, useNativeDriver: true }));
  loop.start();
  return () => loop.stop();
}

function createGooseMotion() {
  const float = native(0);
  const head = native(0);
  const ripple = native(0);
  // Parked past its end, where it is invisible, until it joins the first.
  const echo = native(1);
  // goose-ripple: out from half size to 1.4, fading as it goes.
  const opening = (value: Animated.Value) => ({
    opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
    transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.4] }) }],
  });
  return { float, head, ripple, echo, rippleMotion: opening(ripple), echoMotion: opening(echo) };
}

export const Goose = React.memo(function Goose({ state, size = 150, water = true }: GooseProps) {
  const theme = useInkTheme();
  const reduced = useReduceMotion();
  // `useState` rather than `useRef`: the values are created once and read
  // during render, which a ref cannot be under the React Compiler.
  const [motion] = useState(createGooseMotion);

  const frame = water ? POND : BIRD;
  const unit = size / frame.width;
  const height = frame.height * unit;
  const viewBox = `${frame.x} ${frame.y} ${frame.width} ${frame.height}`;

  const pose = useMemo(() => {
    // Three values, not two: React Native's array form of `transformOrigin`
    // is x, y and z, and throws a render error on a pair.
    const origin = (point: { x: number; y: number }) => [
      (point.x - frame.x) * unit,
      (point.y - frame.y) * unit,
      0,
    ];
    const float = FLOAT[state];
    return {
      float: {
        transformOrigin: origin(FLOAT_ORIGIN),
        transform: [
          { translateY: motion.float.interpolate(keyframes(float.lift, EASE_IN_OUT, unit)) },
          { rotate: motion.float.interpolate(turn(float.roll)) },
        ],
      },
      head: {
        transformOrigin: origin(HEAD_ORIGIN),
        transform: [{ rotate: motion.head.interpolate(turn(HEAD[state])) }],
      },
      ripple: { transformOrigin: origin(RIPPLE_ORIGIN) },
      // `M14 98h132` at a stroke of 2 with round caps, as a box of its own.
      waterline: {
        left: (13 - frame.x) * unit,
        top: (97 - frame.y) * unit,
        width: 134 * unit,
        height: 2 * unit,
        borderRadius: unit,
      },
    };
  }, [motion, state, frame, unit]);

  useEffect(() => {
    if (reduced) return;
    const tempo = TEMPO[state];
    const stops = [runLoop(motion.float, tempo.float), runLoop(motion.head, tempo.head)];
    let join: ReturnType<typeof setTimeout> | undefined;
    if (water) {
      stops.push(runLoop(motion.ripple, tempo.ripple, EASE_OUT));
      // The second ripple joins half a period late, as the stylesheet's
      // `animation-delay` has it, and waits out of sight until then.
      motion.echo.setValue(1);
      join = setTimeout(() => {
        stops.push(runLoop(motion.echo, tempo.ripple, EASE_OUT));
      }, tempo.ripple / 2);
    }
    return () => {
      clearTimeout(join);
      stops.forEach((stop) => stop());
    };
  }, [motion, state, reduced, water]);

  const c = theme.color;
  const ring = (
    <Svg width={size} height={height} viewBox={viewBox}>
      <Ellipse cx={80} cy={98} rx={30} ry={5.5} fill="none" stroke={c.accent} strokeWidth={1.5} />
    </Svg>
  );

  return (
    <View
      style={{ width: size, height }}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {water ? (
        <>
          {/* The ripples open from the waterline; the line itself is still. */}
          <Animated.View
            style={[StyleSheet.absoluteFill, pose.ripple, reduced ? styles.rippleStill : motion.rippleMotion]}
          >
            {ring}
          </Animated.View>
          {reduced ? null : (
            <Animated.View style={[StyleSheet.absoluteFill, pose.ripple, motion.echoMotion]}>{ring}</Animated.View>
          )}
          <View style={[styles.waterline, pose.waterline, { backgroundColor: c.lineStrong }]} />
        </>
      ) : null}

      {/* Everything above the water rides the same bob. */}
      <Animated.View style={[StyleSheet.absoluteFill, reduced ? null : pose.float]}>
        <Svg width={size} height={height} viewBox={viewBox}>
          {/* Elongated rather than round. A circle reads as a duck; the length
              is what makes the silhouette a goose. */}
          <Path d="M40 84c0-14 16-23 39-23s41 8 41 22-17 20-41 20-39-5-39-19z" fill={c.accent} />
          {/* The tail's base sits inside the body's outline. Drawn flush to the
              edge, it reads as a separate shard floating alongside the bird. */}
          <Path d="M106 80l34-19-8 25z" fill={c.accent} />
          {/* A shade down from the body, so the bird has a shoulder. */}
          <Path
            d="M64 78c8-7 22-9 33-4 6 3 7 9 2 13-9 6-26 6-34-1-4-3-4-6-1-8z"
            fill={c.accentPressed}
            opacity={0.55}
          />
        </Svg>

        {/* The neck and head, on their own slower phase. Long, slender and
            tapered: a short wedge is exactly what reads as a duck. */}
        <Animated.View style={[StyleSheet.absoluteFill, reduced ? null : pose.head]}>
          <Svg width={size} height={height} viewBox={viewBox}>
            <Path d="M70 66c-7-15-7-31 0-41l10 2c-5 9-5 25 0 39z" fill={c.accent} />
            <Ellipse cx={75} cy={22} rx={10.5} ry={8.5} fill={c.accent} />
            {/* The chinstrap. Without it a purple head is just a blob. */}
            <Path d="M67 27q8 6 16 0" fill="none" stroke={c.surface} strokeWidth={3} strokeLinecap="round" />
            <Path d="M65 18l-16 5 16 5z" fill={c.warning} />
            <Circle cx={79} cy={19} r={2} fill={c.surface} />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  waterline: { position: 'absolute' },
  rippleStill: { opacity: RIPPLE_STILL },
});
