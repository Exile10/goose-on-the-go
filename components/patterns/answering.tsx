/**
 * What the composer shows while Goose answers: a light behind the composer,
 * and a reminder under the field that fades once the answer is in.
 *
 * The light sits behind the field and its buttons, so they stand in front of
 * it: its glow rims their edges and fills the gaps between them, a faint wash
 * of it falls across their faces, and the field's top edge catches it as a
 * tapered streak. It replaces a spinner under the reply, whose foot moves as
 * words arrive; the composer stays put.
 *
 * It appears behind the send button, where the message just left, and swings
 * between the buttons like a pendulum, easing into each turn, so it never
 * vanishes or jumps. A turn that follows straight on carries on from where the
 * light already is. It runs on the UI thread, because the JS thread is busiest
 * exactly while a reply streams. Reduced motion holds it, lit, behind the
 * middle of the field.
 */

import React, { useEffect, useId, useState } from 'react';
import { Animated as RNAnimated, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
  Easing,
  cancelAnimation,
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
/** One swing, either way. */
const LEG_MS = 1800;
/** Long enough to read it twice once the answer has stopped moving. */
const LINGER_MS = 4000;

/**
 * The streak as layers sharing one centre, longest and thinnest first: it
 * tapers to a point at both ends and swells through the middle, which a single
 * stroke cannot draw. The last is the halo around the swell.
 */
const LAYERS = [
  { share: 1, width: 1, opacity: 0.6 },
  { share: 0.55, width: 2, opacity: 0.8 },
  { share: 0.22, width: 3.25, opacity: 1 },
  { share: 0.5, width: 9, opacity: 0.1 },
] as const;

/**
 * The two pools the light casts: the glow behind the controls, tall enough to
 * show above, between and just below them, and the much fainter wash across
 * their faces. `width` is in streak lengths; `drop` puts the centre that far
 * below the field's top edge, where the streak is.
 */
const GLOW = { width: 2.3, height: 92, drop: 14, opacity: 0.55 };
const WASH = { width: 1.7, height: 64, drop: 18, opacity: 0.22 };

/** How far round each corner the streak's path reaches, from the top: enough to curve, short of the sides. */
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
  // 0 is behind the attach button, 1 behind send; between, the streak's centre along the field's edge.
  const progress = useSharedValue(1);

  useEffect(() => {
    shown.set(withTiming(active ? 1 : 0, { duration: active ? 280 : 420, easing: Easing.out(Easing.cubic) }));
  }, [active, shown]);

  useEffect(() => {
    cancelAnimation(progress);
    if (!active) return;
    if (reduced) {
      progress.set(0.5);
      return;
    }
    // A fresh turn starts behind send; one that follows straight on swings on from where the light is.
    if (shown.get() < 0.05) progress.set(1);
    const from = progress.get();
    const to = from > 0.5 ? 0 : 1;
    const swing = { easing: Easing.inOut(Easing.sin) };
    progress.set(
      withSequence(
        withTiming(to, { ...swing, duration: LEG_MS * Math.abs(to - from) }),
        withRepeat(withTiming(1 - to, { ...swing, duration: LEG_MS }), -1, true),
      ),
    );
    return () => cancelAnimation(progress);
  }, [active, progress, reduced, shown]);

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
  const { progress, shown, reduced } = light;
  const width = Math.round(glint * spec.width);
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: origin + progress.get() * (length + glint) - glint / 2 - width / 2 },
      // It grows into place as it brightens and settles back as it goes, rather than only fading.
      { scale: reduced ? 1 : 0.6 + 0.4 * shown.get() },
    ],
  }));
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

/** The light caught on the field's top edge; the field covers the half of it below the edge. */
function Streak({ light, field, radius }: LightProps) {
  const theme = useInkTheme();
  const { d, length, glint } = geometry(field, radius);
  return (
    <Svg
      width={field.width + PAD * 2}
      height={radius + PAD * 2}
      style={[styles.streak, { left: field.x - PAD, top: field.y - PAD }]}
    >
      {LAYERS.map((layer, i) => (
        <Layer key={i} d={d} length={length} glint={glint} color={theme.color.accentLine} progress={light.progress} {...layer} />
      ))}
    </Svg>
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

/** The band under the composer row that the note is set in: its line, with air above and below. */
export const NOTE_ROOM = 24;

/**
 * The reminder's timing: in as an answer starts, out a while after it ends. The
 * dock reads `room` too, so the band under the field is open only while the note
 * is in it, and closes once the note has faded rather than under it.
 */
export function useAnsweringNote(active: boolean) {
  const [opacity] = useState(() => new RNAnimated.Value(0));
  // Faded all the way out; until then a screen reader can still find it, and the band stays open.
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

  return { opacity, showing, room: showing ? NOTE_ROOM : 0 };
}

export type AnsweringNoteState = ReturnType<typeof useAnsweringNote>;

/** The reminder under the field, set in the band the dock opens for it. */
export function AnsweringNote({ note }: { note: AnsweringNoteState }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const text = inkText(theme, { size: 'sm', leading: 'tight', color: theme.color.textTertiary });
  return (
    <View pointerEvents="none" style={styles.note}>
      <RNAnimated.Text
        style={[text.style, styles.noteText, { opacity: note.opacity }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        accessibilityElementsHidden={!note.showing}
        importantForAccessibility={note.showing ? 'yes' : 'no-hide-descendants'}
        accessibilityLiveRegion="polite"
      >
        {t('chat.mistakes')}
      </RNAnimated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pool: { position: 'absolute', left: 0 },
  streak: { position: 'absolute' },
  // Above the buttons' lift, which on Android is elevation and outranks drawing order.
  wash: { zIndex: 2, elevation: 13 },
  note: { position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 5, alignItems: 'center' },
  noteText: { textAlign: 'center' },
});
