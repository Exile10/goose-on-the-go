/**
 * VoiceOrb — the voice screen's one control, and the face Goose talks with.
 *
 * pond-desktop's glass orb brought across: `components/VoiceOrb.tsx` and the
 * `.orb-glass` rules in `styles/sections.css`, with the same parts, the same
 * state colours and the same timings. A glass core whose eyes blink and
 * wander; a ring that pulses while the Pond waits or thinks; a swell and a
 * halo that follow the voice while it listens or speaks; sparks when the reply
 * is loud; a flash the moment speech is heard; a shake on an error.
 *
 * The desktop runs all of that in CSS. Here each loop is one `Animated.Value`
 * on the native driver and the keyframes live in the interpolations it drives,
 * so between state changes the orb costs the JS thread nothing. That matters
 * more on a phone: the orb is on screen for the whole of a voice turn, and the
 * JS thread is the one reading the reply as it streams in from the household's
 * box. The level arrives about sixteen times a second and re-renders only the
 * orb's shell — the art sits behind a memo boundary the level never crosses,
 * and its SVG is redrawn only when the state's colour changes.
 *
 * Two things did not come across. React Native has no backdrop blur, so the
 * core's frosting is a radial gradient, milky where the light enters and clear
 * at the rim, with a highlight so it reads as a sphere rather than a disc. And
 * the eyes no longer follow a cursor, because a phone has none.
 *
 * Reduced motion gets a still pose rather than a blank one: no bob, no loops,
 * no sparks, the ring parked where it reads and the halo at its resting glow.
 * The colours still ease between states. A fade is not the vestibular problem,
 * and the colour is what says which state the orb is in.
 */

import { GPressable } from '@/components/ui/g-pressable';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { alpha } from '@jarida/ink';
import { useInkTheme, useReduceMotion } from '@/components/ui/ink';

import type { VoiceState } from '@/models/voice';

/**
 * pond-desktop's `--orb-*` tokens. Fixed rather than themed: each names a
 * state, and a state has to read the same on a light phone as on a dark one.
 */
const STATE_COLOR: Record<VoiceState, string> = {
  idle: '#8E8E93',
  wait: '#8C4BFF',
  recording: '#3B9EFF',
  thinking: '#FF9500',
  speaking: '#34C759',
  error: '#FF3B30',
};

/** The ring pulses while the Pond waits for speech, and quicker while it thinks. */
const PULSE_MS: Partial<Record<VoiceState, number>> = { wait: 2400, thinking: 1300 };

const BOB_MS = 3600;
const BLINK_MS = 5500;
const LOOK_MS = 9000;
const WINK_MS = 450;
const FLASH_MS = 600;
const SHAKE_MS = 400;
const SMILE_MS = 250;
const TONE_MS = 250;
/**
 * How long the swell and the halo take to reach a new level: two of the ~60ms
 * reports the voice pipeline sends, so the steps between reports become
 * breathing without the orb lagging the voice.
 */
const FOLLOW_MS = 120;

/** While speaking, a level at or past this throws a burst, at most once per 200ms. */
const SPARK_LEVEL = 0.32;
const SPARK_EVERY_MS = 200;
const SPARK_MS = 1400;
const SPARK_SIZE = 7;
/**
 * Six to a burst from a pool of twenty-four. The desktop throws twenty and lets
 * 160 live at once; a phone has less to spend, and six evenly spaced still read
 * as a burst.
 */
const SPARKS_PER_BURST = 6;
const SPARK_POOL = 24;

/**
 * Where the ring is held under reduced motion: a quarter of the way through a
 * pulse, clear of the core and not yet faded.
 */
const PULSE_STILL = 0.25;

// CSS's named curves, spelled out. React Native's `Easing.ease` is CSS's
// ease-in, not its `ease`, so the names cannot be borrowed.
const EASE = Easing.bezier(0.25, 0.1, 0.25, 1);
const EASE_IN_OUT = Easing.bezier(0.42, 0, 0.58, 1);
const EASE_OUT = Easing.bezier(0, 0, 0.58, 1);

type Keyframe = readonly [at: number, value: number];

/** Points sampled along each eased segment: enough that the straight runs between them never show. */
const SAMPLES = 8;

/**
 * A CSS `@keyframes` block, as an interpolation a native loop can drive.
 *
 * CSS eases each segment between two keyframes on its own curve; an
 * interpolation joins its points with straight lines. Sampling each segment's
 * curve puts the ease back, and keeps the whole cycle one `0 → 1` timing that
 * loops on the UI thread. `unit` scales the values, for keyframes written as a
 * fraction of some box.
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

// orb-hover. The whole orb rides it, whatever state it is in.
const BOB = keyframes([[0, 0], [0.5, -6], [1, 0]]);
// orb-eye-blink: shut and open again in a fifth of a second, twice a cycle.
const BLINK = keyframes([[0, 1], [0.02, 0.12], [0.04, 1], [0.46, 1], [0.48, 0.12], [0.5, 1], [1, 1]]);
// orb-eye-wink.
const WINK = keyframes([[0, 1], [0.4, 0.08], [0.7, 0.08], [1, 1]]);
// orb-error-shake, under the rule's own `ease`.
const SHAKE = keyframes([[0, 0], [0.25, -3], [0.75, 3], [1, 0]], EASE);
// orb-eye-look, as fractions of the eye's own box, which is what a CSS
// `translate` percentage is.
const LOOK_X: readonly Keyframe[] = [[0, 0], [0.15, 0.3], [0.35, -0.25], [0.55, 0.15], [0.75, -0.2], [0.9, 0], [1, 0]];
const LOOK_Y: readonly Keyframe[] = [[0, 0], [0.15, -0.15], [0.35, 0.2], [0.55, 0.2], [0.75, -0.15], [0.9, 0], [1, 0]];

/**
 * Created native, so a `setValue` goes straight to the UI thread instead of
 * re-rendering the views it drives. Web has no native animated module, and a
 * value created native there throws as soon as a view mounts it.
 */
function native(at: number) {
  return Platform.OS === 'web' ? new Animated.Value(at) : new Animated.Value(at, { useNativeDriver: true });
}

/** Runs `value` from 0 to 1 forever, entirely on the UI thread, and returns the stop. */
function runLoop(value: Animated.Value, duration: number, easing: (t: number) => number = Easing.linear) {
  // A native loop repeats from wherever it started, so it has to start at 0.
  value.setValue(0);
  const loop = Animated.loop(Animated.timing(value, { toValue: 1, duration, easing, useNativeDriver: true }));
  loop.start();
  return () => loop.stop();
}

function glide(value: Animated.Value, toValue: number, duration: number, easing: (t: number) => number = Easing.linear) {
  Animated.timing(value, { toValue, duration, easing, useNativeDriver: true }).start();
}

/** A level the orb can use. A stray NaN from the meter reads as silence, not as a crash. */
function clampLevel(level: number) {
  return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
}

function createSpark() {
  const angle = native(0);
  // Parked at the end of its drift, where it has faded out.
  const progress = native(1);
  return {
    angle,
    progress,
    turn: angle.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] }),
    scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }),
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
  };
}

function createOrbMotion() {
  const bob = native(0);
  const blink = native(0);
  const look = native(0);
  const wink = native(0);
  const shake = native(0);
  const smile = native(0);
  const live = native(0);
  const drive = native(0);
  const hue = native(0);
  // Both rest past their end, where there is nothing left to see.
  const pulse = native(1);
  const flash = native(1);

  const lid = blink.interpolate(BLINK);
  return {
    bob,
    blink,
    look,
    wink,
    shake,
    smile,
    live,
    drive,
    hue,
    pulse,
    flash,
    lift: bob.interpolate(BOB),
    lid,
    // The wink closes the lid itself. The desktop stacks a second lid over the
    // first and closes that one, which leaves the open lid showing beneath it.
    winkLid: Animated.multiply(lid, wink.interpolate(WINK)),
    jolt: shake.interpolate(SHAKE),
    // Only recording and speaking follow the voice, so the swell and the halo
    // are both gated by `live`, which eases in and out as those states do.
    swell: Animated.multiply(live, drive).interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }),
    glow: Animated.multiply(live, drive.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.8] })),
    // orb-pulse, whose far edge and first opacity both grow with the level:
    // scale 0.62 to 1.15 + 0.35 x level, opacity 0.22 + 0.3 x level to 0.
    ringScale: Animated.add(
      pulse.interpolate({ inputRange: [0, 1], outputRange: [0.62, 1.15] }),
      Animated.multiply(pulse, drive.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] })),
    ),
    ringOpacity: Animated.multiply(
      pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      drive.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.52] }),
    ),
    flashScale: flash.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.6] }),
    flashOpacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
    sparks: Array.from({ length: SPARK_POOL }, createSpark),
  };
}

type OrbMotion = ReturnType<typeof createOrbMotion>;
type Spark = ReturnType<typeof createSpark>;

/**
 * The state colour, easing between states on the native driver.
 *
 * Each change adds a stop to a short chain along a clock that only ever counts
 * up, and the clock runs on to the new end. The chain keeps the stop the last
 * fade was heading for, so a change that lands mid-fade carries on from the
 * colour on screen rather than jumping to where that fade was going. Only a
 * third change inside a single fade can jump, and never far.
 */
function useTone(clock: Animated.Value, state: VoiceState) {
  const [chain, setChain] = useState(() => {
    const color = STATE_COLOR[state];
    return { state, step: 0, stops: [color, color, color] };
  });
  // Derived during render rather than in an effect, so the first frame of the
  // new state already carries the chain it will fade along.
  if (chain.state !== state) {
    setChain({
      state,
      step: chain.step + 1,
      stops: [chain.stops[1], chain.stops[2], STATE_COLOR[state]],
    });
  }
  const { step, stops } = chain;

  useEffect(() => {
    glide(clock, step, TONE_MS, EASE);
  }, [clock, step]);

  return useMemo(
    () =>
      clock.interpolate<string>({
        inputRange: [step - 2, step - 1, step],
        outputRange: stops,
        extrapolate: 'clamp',
      }),
    [clock, step, stops],
  );
}

/**
 * The desktop's boxes, solved once for a diameter.
 *
 * The core is 62% of the orb. Its column holds the face (56% by 30% of the
 * core) and the mouth strip (26% by 8%) with an 8% gap, centred, which puts the
 * eyes' centres at 42% of the core's height and the strip's top at 65%. An eye
 * is 13% of the face's width at a 0.4 aspect, and the pair sit 22% of the face
 * apart. The halo reaches 8% past the orb, and the flash 10%.
 */
function orbLayout(size: number) {
  const core = size * 0.62;
  const face = core * 0.56;
  const eyeWidth = face * 0.13;
  const eyeHeight = eyeWidth / 0.4;
  const eyeGap = face * 0.22;
  const eyeTop = core * 0.42 - eyeHeight / 2;
  const mouth = core * 0.26;
  const halo = size * 1.16;
  const flash = size * 1.2;
  const inset = (size - core) / 2;
  return {
    core,
    halo,
    eyeWidth,
    eyeHeight,
    sheet: StyleSheet.create({
      ring: { width: size, height: size, borderRadius: size / 2 },
      halo: { left: (size - halo) / 2, top: (size - halo) / 2, width: halo, height: halo },
      flash: {
        left: (size - flash) / 2,
        top: (size - flash) / 2,
        width: flash,
        height: flash,
        borderRadius: flash / 2,
      },
      core: { left: inset, top: inset, width: core, height: core },
      disc: { borderRadius: core / 2 },
      outline: { left: -1, top: -1, width: core + 2, height: core + 2, borderRadius: core / 2 + 1 },
      eyeLeft: { left: core / 2 - eyeGap / 2 - eyeWidth, top: eyeTop, width: eyeWidth, height: eyeHeight },
      eyeRight: { left: core / 2 + eyeGap / 2, top: eyeTop, width: eyeWidth, height: eyeHeight },
      // Half the width, so the ends are round and the sides straight: a capsule, not an ellipse.
      lid: { borderRadius: eyeWidth / 2 },
      mouthStrip: { left: (core - mouth) / 2, top: core * 0.65, width: mouth, height: core * 0.08 },
      // A ring raised by 72% of itself, so the strip shows only its bottom edge: the smile.
      mouth: { top: -mouth * 0.72, width: mouth, height: mouth, borderRadius: mouth / 2 },
    }),
  };
}

/** The halo: 55% of the state colour at the centre, gone by the edge. */
const OrbHalo = React.memo(function OrbHalo({ size, color }: { size: number; color: string }) {
  const id = useId();
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset={0} stopColor={color} stopOpacity={0.55} />
          <Stop offset={1} stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={50} cy={50} r={50} fill={`url(#${id})`} />
    </Svg>
  );
});

/**
 * The core's glass, standing in for the desktop's `backdrop-filter: blur(6px)`.
 *
 * A frost of the surface colour veils whatever is behind the core, thickest
 * where the light comes in at the upper left and thinning towards the rim, so
 * the state's tint gathers at the edge the way colour does in a glass bead. A
 * faint darkening at the limb gives it depth. The highlight is white in either
 * scheme: a reflection is the colour of the light, not of the surface.
 */
const OrbGlass = React.memo(function OrbGlass({
  size,
  frost,
  limb,
}: {
  size: number;
  frost: string;
  limb: string;
}) {
  const id = useId();
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id={`${id}-frost`} cx="42%" cy="36%" r="62%">
          <Stop offset={0} stopColor={frost} stopOpacity={0.45} />
          <Stop offset={0.7} stopColor={frost} stopOpacity={0.14} />
          <Stop offset={1} stopColor={frost} stopOpacity={0.04} />
        </RadialGradient>
        <RadialGradient id={`${id}-limb`} cx="50%" cy="50%" r="50%">
          <Stop offset={0.66} stopColor={limb} stopOpacity={0} />
          <Stop offset={1} stopColor={limb} stopOpacity={0.07} />
        </RadialGradient>
        <RadialGradient id={`${id}-shine`} cx="50%" cy="50%" r="50%">
          <Stop offset={0} stopColor="#FFFFFF" stopOpacity={0.8} />
          <Stop offset={0.5} stopColor="#FFFFFF" stopOpacity={0.28} />
          <Stop offset={1} stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={50} cy={50} r={50} fill={`url(#${id}-frost)`} />
      <Circle cx={50} cy={50} r={50} fill={`url(#${id}-limb)`} />
      <Ellipse cx={33} cy={24} rx={17} ry={9.5} transform="rotate(-32 33 24)" fill={`url(#${id}-shine)`} />
      {/* Light that passed through the glass and caught the far side. */}
      <Ellipse
        cx={67}
        cy={80}
        rx={12}
        ry={4.5}
        transform="rotate(-32 67 80)"
        fill={`url(#${id}-shine)`}
        opacity={0.3}
      />
    </Svg>
  );
});

/** The pool of sparks, each turned to its angle and then drifted outward along it. */
const OrbSparks = React.memo(function OrbSparks({
  sparks,
  size,
  color,
}: {
  sparks: readonly Spark[];
  size: number;
  color: string;
}) {
  // 0.42 of the diameter clears the halo, so a burst starts just outside the
  // orb rather than inside it and drifting out through the glow.
  const reach = size * 0.42;
  const drifts = useMemo(
    () =>
      sparks.map((spark) => ({
        opacity: spark.opacity,
        transform: [
          { rotate: spark.turn },
          {
            translateY: spark.progress.interpolate({
              inputRange: [0, 1],
              outputRange: [-reach, -reach * 2.2],
            }),
          },
          { scale: spark.scale },
        ],
      })),
    [sparks, reach],
  );
  const paint = useMemo(
    () => ({
      left: (size - SPARK_SIZE) / 2,
      top: (size - SPARK_SIZE) / 2,
      backgroundColor: color,
      // A glow, so a spark reads against the orb's own colour instead of
      // blending into it.
      boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 6, spreadDistance: 1, color }],
    }),
    [size, color],
  );
  return (
    <>
      {drifts.map((drift, i) => (
        <Animated.View key={i} style={[styles.spark, paint, drift]} />
      ))}
    </>
  );
});

interface OrbArtProps {
  motion: OrbMotion;
  size: number;
  /** The state colour, easing between states: for the parts the desktop transitions. */
  tone: Animated.AnimatedInterpolation<string>;
  /** The state colour as it stands: for the parts the desktop simply repaints. */
  color: string;
  sparks: boolean;
}

/**
 * Everything the orb draws. Behind a memo because none of it depends on the
 * level, which reaches it only through the native nodes: it re-renders when
 * the state, the size or the theme changes, and at no other time.
 */
const OrbArt = React.memo(function OrbArt({ motion, size, tone, color, sparks }: OrbArtProps) {
  const theme = useInkTheme();
  const layout = useMemo(() => orbLayout(size), [size]);
  const { sheet } = layout;
  const gaze = useMemo(
    () => [
      { translateX: motion.look.interpolate(keyframes(LOOK_X, EASE_IN_OUT, layout.eyeWidth)) },
      { translateY: motion.look.interpolate(keyframes(LOOK_Y, EASE_IN_OUT, layout.eyeHeight)) },
    ],
    [motion, layout],
  );
  const ink = theme.color.text;

  return (
    // Nothing drawn takes a touch. The rings and sparks reach well past the
    // orb, and a tap on the conversation beside it must not land on the button.
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { transform: [{ translateY: motion.lift }] }]}
    >
      {/* The desktop mounts three rings but only ever animates the first: two
          more copies stacked under it read as one solid disc. So one is drawn. */}
      <Animated.View
        style={[
          styles.layer,
          styles.ring,
          sheet.ring,
          { borderColor: color, opacity: motion.ringOpacity, transform: [{ scale: motion.ringScale }] },
        ]}
      />
      <Animated.View style={[styles.layer, sheet.halo, { opacity: motion.glow }]}>
        <OrbHalo size={layout.halo} color={color} />
      </Animated.View>
      <Animated.View
        style={[
          styles.layer,
          styles.flash,
          sheet.flash,
          { borderColor: color, opacity: motion.flashOpacity, transform: [{ scale: motion.flashScale }] },
        ]}
      />
      <Animated.View
        style={[
          styles.layer,
          sheet.core,
          { transform: [{ translateX: motion.jolt }, { scale: motion.swell }] },
        ]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, sheet.disc, styles.tint, { backgroundColor: tone }]} />
        <OrbGlass size={layout.core} frost={theme.color.surface} limb={ink} />
        <Animated.View style={[StyleSheet.absoluteFill, sheet.disc, styles.rim, { borderColor: tone }]} />
        {/* A hairline of the text colour outside the rim, so the core never
            vanishes against a page too close to its own hue. */}
        <View style={[styles.layer, styles.outline, sheet.outline, { borderColor: alpha(ink, 0.12) }]} />
        <Animated.View style={[styles.layer, sheet.eyeLeft, { transform: gaze }]}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              sheet.lid,
              styles.lid,
              { backgroundColor: tone, transform: [{ scaleY: motion.lid }] },
            ]}
          />
        </Animated.View>
        <Animated.View style={[styles.layer, sheet.eyeRight, { transform: gaze }]}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              sheet.lid,
              styles.lid,
              { backgroundColor: tone, transform: [{ scaleY: motion.winkLid }] },
            ]}
          />
        </Animated.View>
        <Animated.View style={[styles.layer, styles.strip, sheet.mouthStrip, { opacity: motion.smile }]}>
          <View style={[styles.mouth, sheet.mouth, { borderColor: ink }]} />
        </Animated.View>
      </Animated.View>
      {sparks ? <OrbSparks sparks={motion.sparks} size={size} color={color} /> : null}
    </Animated.View>
  );
});

export interface VoiceOrbProps {
  state: VoiceState;
  /**
   * The live level, 0 to 1: the microphone while recording, the reply while
   * speaking. Already scaled for the eye, as `orbLevel` does; raw RMS barely
   * moves it.
   */
  level: number;
  /** Diameter in points. The rings, halo and sparks reach past it, and take no touches there. */
  size?: number;
  /** Makes the orb a button. Without it the orb is decoration, hidden from assistive technology. */
  onPress?: () => void;
  /** What a press does, for a screen reader. The orb has no words of its own. */
  accessibilityLabel?: string;
}

export const VoiceOrb = React.memo(function VoiceOrb({
  state,
  level,
  size = 220,
  onPress,
  accessibilityLabel,
}: VoiceOrbProps) {
  const reduced = useReduceMotion();
  // `useState` rather than `useRef`: the values are created once and read
  // during render, which a ref cannot be under the React Compiler.
  const [motion] = useState(createOrbMotion);
  const tone = useTone(motion.hue, state);
  const heard = clampLevel(level);

  // The bob is the orb's own, in every state: it floats whatever it is doing.
  useEffect(() => {
    if (reduced) {
      motion.bob.setValue(0);
      return;
    }
    return runLoop(motion.bob, BOB_MS);
  }, [motion, reduced]);

  // An error holds the eyes open and centred, as the desktop's does.
  const eyesStill = reduced || state === 'error';
  useEffect(() => {
    if (eyesStill) {
      motion.blink.setValue(0);
      motion.look.setValue(0);
      return;
    }
    const stopBlink = runLoop(motion.blink, BLINK_MS);
    const stopLook = runLoop(motion.look, LOOK_MS);
    return () => {
      stopBlink();
      stopLook();
    };
  }, [motion, eyesStill]);

  const pulseMs = PULSE_MS[state];
  useEffect(() => {
    if (pulseMs === undefined) {
      motion.pulse.setValue(1);
      return;
    }
    if (reduced) {
      motion.pulse.setValue(PULSE_STILL);
      return;
    }
    return runLoop(motion.pulse, pulseMs, EASE_OUT);
  }, [motion, pulseMs, reduced]);

  const live = state === 'recording' || state === 'speaking';
  useEffect(() => {
    glide(motion.live, live ? 1 : 0, FOLLOW_MS);
  }, [motion, live]);

  // Reduced motion holds the level at rest, so the core keeps its size and the
  // halo the glow it has in silence.
  const target = reduced ? 0 : heard;
  useEffect(() => {
    glide(motion.drive, target, FOLLOW_MS);
  }, [motion, target]);

  const smiling = state === 'speaking';
  useEffect(() => {
    glide(motion.smile, smiling ? 0.85 : 0, SMILE_MS, EASE);
  }, [motion, smiling]);

  // The moment speech is heard, waiting becomes recording, and the orb flashes
  // and winks. The desktop's screen bumps a key on that same transition; the
  // orb can see it for itself.
  const previous = useRef(state);
  useEffect(() => {
    const began = previous.current === 'wait' && state === 'recording';
    previous.current = state;
    if (!began || reduced) return;
    motion.flash.setValue(0);
    motion.wink.setValue(0);
    glide(motion.flash, 1, FLASH_MS, EASE_OUT);
    glide(motion.wink, 1, WINK_MS);
  }, [motion, state, reduced]);

  const shaking = state === 'error' && !reduced;
  useEffect(() => {
    if (!shaking) return;
    motion.shake.setValue(0);
    glide(motion.shake, 1, SHAKE_MS);
  }, [motion, shaking]);

  // Sparks come from a fixed pool rather than a new view per burst. A burst
  // that finds too few free is skipped rather than cutting a live spark short:
  // one that vanishes mid-fade reads as a glitch, and a burst that never came
  // reads as nothing at all.
  const sparking = state === 'speaking' && !reduced;
  const lastBurst = useRef(0);
  const busyUntil = useRef<number[]>([]);
  useEffect(() => {
    if (!sparking || heard < SPARK_LEVEL) return;
    const now = Date.now();
    if (now - lastBurst.current < SPARK_EVERY_MS) return;
    const free: number[] = [];
    motion.sparks.forEach((_, i) => {
      if ((busyUntil.current[i] ?? 0) <= now) free.push(i);
    });
    if (free.length < SPARKS_PER_BURST) return;
    lastBurst.current = now;
    // Spaced evenly with a little jitter, so it reads as one burst. A single
    // spark was easy to miss, especially when it went out behind the face.
    const base = Math.random() * 360;
    free.slice(0, SPARKS_PER_BURST).forEach((i, n) => {
      const spark = motion.sparks[i];
      spark.angle.setValue(base + (n * 360) / SPARKS_PER_BURST + Math.random() * 20 - 10);
      spark.progress.setValue(0);
      glide(spark.progress, 1, SPARK_MS, EASE_OUT);
      busyUntil.current[i] = now + SPARK_MS;
    });
  }, [motion, sparking, heard]);

  const art = (
    <OrbArt motion={motion} size={size} tone={tone} color={STATE_COLOR[state]} sparks={!reduced} />
  );

  if (!onPress) {
    return (
      <View
        style={{ width: size, height: size }}
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {art}
      </View>
    );
  }

  return (
    <GPressable feedback="none"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: state === 'thinking' }}
      style={({ pressed }) => [
        { width: size, height: size },
        pressed ? (reduced ? styles.dim : styles.lift) : null,
      ]}
    >
      {art}
    </GPressable>
  );
});

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
  ring: { borderWidth: 1 },
  flash: { borderWidth: 2 },
  tint: { opacity: 0.07 },
  rim: { borderWidth: 1.5, opacity: 0.65 },
  outline: { borderWidth: 1 },
  lid: { opacity: 0.85 },
  strip: { overflow: 'hidden' },
  mouth: { position: 'absolute', left: 0, borderWidth: 2 },
  spark: {
    position: 'absolute',
    width: SPARK_SIZE,
    height: SPARK_SIZE,
    borderRadius: SPARK_SIZE / 2,
  },
  // A press answers on the way down, as the app's other controls do: the orb
  // gives a little, or under reduced motion dims instead of moving.
  lift: { transform: [{ scale: 0.97 }] },
  dim: { opacity: 0.7 },
});
