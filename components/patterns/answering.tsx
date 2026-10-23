/**
 * What the composer shows while Goose answers: a light behind the composer
 * that runs along the field's top border, and a reminder under the field that
 * fades once the answer is in.
 *
 * The light sits behind the field and its buttons, so they stand in front of
 * it: its glow rims their edges and fills the gaps between them, and a faint
 * wash of it falls across their faces as it passes. The tapered streak on the
 * field's top border is the light itself. It replaces a spinner under the
 * reply, whose foot moves as words arrive; the composer stays put.
 *
 * It runs on the UI thread, because the JS thread is busiest exactly while a
 * reply streams. Reduced motion parks the light behind the middle of the field
 * and keeps it lit, which still says "working" without anything travelling.
 */

import React, { useEffect, useId, useState } from 'react';
import { Animated as RNAnimated, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';
import { inkText, useInkTheme, useReduceMotion } from '@jarida/ink/native';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Room around the border for the streak's halo, which is wider than the line. */
const PAD = 5;
const SWEEP_MS = 1600;
const REST_MS = 350;
/** Long enough to read it twice once the answer has stopped moving. */
const LINGER_MS = 4000;

/**
 * The streak as layers sharing one centre, longest and thinnest first: it
 * tapers to a point at both ends and swells through the middle, which a single
 * stroke cannot draw. The last two are the halo around the swell.
 */
const LAYERS = [
  { share: 1, width: 1, opacity: 0.55 },
  { share: 0.7, width: 1.75, opacity: 0.7 },
  { share: 0.42, width: 2.5, opacity: 0.85 },
  { share: 0.18, width: 3.25, opacity: 1 },
  { share: 0.62, width: 6, opacity: 0.08 },
  { share: 0.34, width: 10, opacity: 0.08 },
] as const;

/**
 * The two pools the light casts: the glow behind the controls, tall enough to
 * show above, between and just below them, and the much fainter wash across
 * their faces. `width` is in streak lengths; `drop` puts the centre that far
 * below the field's top edge, where the streak is.
 */
const GLOW = { width: 2.3, height: 92, drop: 14, opacity: 0.55 };
const WASH = { width: 1.7, height: 64, drop: 18, opacity: 0.22 };

/** How far round each corner the line starts and ends, from the top: enough to curve, short of the sides. */
const CORNER = (40 * Math.PI) / 180;

/** Where the field sits in the composer row, which is the light's frame. */
export interface FieldBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// SVG ids are referenced from `url(#…)`, where the colons `useId` returns end the reference early.
const svgId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '');

/** Out of the left corner, along the top, and into the right corner. */
function topBorder(width: number, radius: number) {
  const left = PAD;
  const right = width - PAD;
  const r = Math.min(radius, (right - left) / 2);
  const dx = r * Math.sin(CORNER);
  const y = PAD + r - r * Math.cos(CORNER);
  const d = `M ${left + r - dx} ${y} A ${r} ${r} 0 0 1 ${left + r} ${PAD} L ${right - r} ${PAD} A ${r} ${r} 0 0 1 ${right - r + dx} ${y}`;
  return { d, length: 2 * r * CORNER + (right - left - 2 * r), start: left + r - dx };
}

function geometry(field: FieldBox, radius: number) {
  const { d, length, start } = topBorder(field.width + PAD * 2, radius);
  const glint = Math.max(72, Math.round(length * 0.36));
  // The streak's path begins here in the row; the pools are measured from the same place, so they move as one.
  return { d, length, glint, origin: field.x - PAD + start };
}

/** One light for the whole composer, shared by what is drawn behind the controls and what falls on them. */
export function useAnsweringLight(active: boolean) {
  const reduced = useReduceMotion();
  const shown = useSharedValue(0);
  const progress = useSharedValue(0.5);

  useEffect(() => {
    shown.set(withTiming(active ? 1 : 0, { duration: active ? 200 : 360 }));
  }, [active, shown]);

  useEffect(() => {
    if (!active || reduced) {
      cancelAnimation(progress);
      if (reduced) progress.set(0.5);
      return;
    }
    progress.set(0);
    progress.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.cubic) }),
          withTiming(1, { duration: REST_MS }),
          withTiming(0, { duration: 0 }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(progress);
  }, [active, progress, reduced]);

  return { active, reduced, shown, progress };
}

export type AnsweringLightState = ReturnType<typeof useAnsweringLight>;

interface LightProps {
  light: AnsweringLightState;
  field: FieldBox;
  radius: number;
}

function Layer({
  d,
  length,
  glint,
  share,
  width,
  opacity,
  color,
  progress,
}: {
  d: string;
  length: number;
  glint: number;
  share: number;
  width: number;
  opacity: number;
  color: string;
  progress: SharedValue<number>;
}) {
  const dash = glint * share;
  // The centre runs from half a glint before the left end to half past the right; every dash sits on it.
  const props = useAnimatedProps(() => ({
    strokeDashoffset: dash / 2 + glint / 2 - progress.get() * (length + glint),
  }));
  return (
    <AnimatedPath
      d={d}
      fill="none"
      stroke={color}
      strokeOpacity={opacity}
      strokeWidth={width}
      strokeLinecap="round"
      strokeDasharray={[dash, length + glint]}
      animatedProps={props}
    />
  );
}

/** A pool of the light, riding with the streak's centre, just below the field's top edge. */
function Pool({ light, field, radius, spec }: LightProps & { spec: typeof GLOW }) {
  const theme = useInkTheme();
  const id = svgId(useId());
  const { length, glint, origin } = geometry(field, radius);
  const { progress, reduced } = light;
  const width = Math.round(glint * spec.width);
  const style = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: reduced ? 1 : interpolate(p, [0, 0.04, 0.96, 1], [0, 1, 1, 0]),
      transform: [{ translateX: origin + p * (length + glint) - glint / 2 - width / 2 }],
    };
  });
  const ink = theme.color.accentLine;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.pool, { width, height: spec.height, top: field.y + spec.drop - spec.height / 2 }, style]}
    >
      <Svg width={width} height={spec.height}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset={0} stopColor={ink} stopOpacity={spec.opacity} />
            <Stop offset={0.55} stopColor={ink} stopOpacity={spec.opacity * 0.35} />
            <Stop offset={1} stopColor={ink} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={width / 2} cy={spec.height / 2} rx={width / 2} ry={spec.height / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/** The light itself, on the field's top border; the field covers the half of it below the edge. */
function Streak({ light, field, radius }: LightProps) {
  const theme = useInkTheme();
  const { d, length, glint } = geometry(field, radius);
  const { progress, reduced } = light;
  const width = field.width + PAD * 2;
  const height = radius + PAD * 2;
  // Faded at both ends, so it rises out of the field's left corner and sinks into its right.
  const glow = useAnimatedStyle(() => ({ opacity: interpolate(progress.get(), [0, 0.06, 0.94, 1], [0, 1, 1, 0]) }));
  const ink = theme.color.accentLine;
  return (
    <View style={[styles.streak, { left: field.x - PAD, top: field.y - PAD, width, height }]}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Path d={d} fill="none" stroke={ink} strokeOpacity={reduced ? 0.9 : 0.4} strokeWidth={2} strokeLinecap="round" />
        {reduced ? <Path d={d} fill="none" stroke={ink} strokeOpacity={0.16} strokeWidth={8} strokeLinecap="round" /> : null}
      </Svg>
      {reduced ? null : (
        <Animated.View style={[StyleSheet.absoluteFill, glow]}>
          <Svg width={width} height={height}>
            {LAYERS.map((layer, i) => (
              <Layer key={i} d={d} length={length} glint={glint} color={ink} progress={progress} {...layer} />
            ))}
          </Svg>
        </Animated.View>
      )}
    </View>
  );
}

/** Drawn first in the composer row, so the field and its buttons stand in front of it. */
export function AnsweringLight({ light, field, radius }: LightProps) {
  const { t } = useTranslation();
  const lit = useAnimatedStyle(() => ({ opacity: light.shown.get() }));
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel={t('chat.stillAnswering')}
      accessibilityElementsHidden={!light.active}
      importantForAccessibility={light.active ? 'yes' : 'no-hide-descendants'}
      style={[StyleSheet.absoluteFill, lit]}
    >
      <Pool light={light} field={field} radius={radius} spec={GLOW} />
      <Streak light={light} field={field} radius={radius} />
    </Animated.View>
  );
}

/** Drawn last in the composer row: the same light, faintly, on the faces of the field and its buttons. */
export function AnsweringWash({ light, field, radius }: LightProps) {
  const lit = useAnimatedStyle(() => ({ opacity: light.shown.get() }));
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.wash, lit]}
    >
      <Pool light={light} field={field} radius={radius} spec={WASH} />
    </Animated.View>
  );
}

/** The reminder under the field: in as an answer starts, out a while after it ends. */
export function AnsweringNote({ active }: { active: boolean }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const [opacity] = useState(() => new RNAnimated.Value(0));
  // Faded all the way out; until then a screen reader can still find it.
  const [gone, setGone] = useState(true);
  const showing = active || !gone;

  useEffect(() => {
    if (active) {
      RNAnimated.timing(opacity, { toValue: 1, duration: 240, useNativeDriver: true }).start(() => setGone(false));
      return;
    }
    const timer = setTimeout(() => {
      RNAnimated.timing(opacity, { toValue: 0, duration: 600, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setGone(true);
      });
    }, LINGER_MS);
    return () => clearTimeout(timer);
  }, [active, opacity]);

  const note = inkText(theme, { size: 'sm', leading: 'tight', color: theme.color.textTertiary });
  return (
    <View pointerEvents="none" style={styles.note}>
      <RNAnimated.Text
        style={[note.style, styles.noteText, { opacity }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        accessibilityElementsHidden={!showing}
        importantForAccessibility={showing ? 'yes' : 'no-hide-descendants'}
        accessibilityLiveRegion="polite"
      >
        {t('chat.mistakes')}
      </RNAnimated.Text>
    </View>
  );
}

/** The band under the composer row that the note is set in: its line, with air above and below. */
export const NOTE_ROOM = 24;

const styles = StyleSheet.create({
  pool: { position: 'absolute', left: 0 },
  streak: { position: 'absolute' },
  // Above the buttons' lift, which on Android is elevation and outranks drawing order.
  wash: { zIndex: 2, elevation: 13 },
  note: { position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 5, alignItems: 'center' },
  noteText: { textAlign: 'center' },
});
