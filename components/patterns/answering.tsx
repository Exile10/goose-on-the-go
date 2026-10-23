/**
 * What the composer shows while Goose answers: a glint running along the
 * field's top border, over both rounded corners, and a reminder under the field
 * that fades once the answer is in.
 *
 * The glint replaces a spinner under the reply. The reply's foot moves as
 * words arrive and its tool chips gather there, so a wheel at the foot chased
 * the text; the field stays put. It runs on the UI thread, because the JS
 * thread is busiest exactly while a reply streams. Reduced motion stops the
 * glint and keeps the border lit, which still says "working" without anything
 * travelling.
 */

import React, { useEffect, useState } from 'react';
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
import Svg, { Path } from 'react-native-svg';
import { inkText, useInkTheme, useReduceMotion } from '@jarida/ink/native';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Room around the border for the halo, which is wider than the line. */
const PAD = 5;
const SWEEP_MS = 1600;
const REST_MS = 350;
/** Long enough to read it twice once the answer has stopped moving. */
const LINGER_MS = 4000;

/**
 * The glint as layers sharing one centre, longest and thinnest first: a streak
 * that tapers to a point at both ends and swells through the middle, which a
 * single stroke cannot draw. The last is the halo around the swell.
 */
const LAYERS = [
  { share: 1, width: 1, opacity: 0.55 },
  { share: 0.7, width: 1.75, opacity: 0.7 },
  { share: 0.42, width: 2.5, opacity: 0.85 },
  { share: 0.18, width: 3.25, opacity: 1 },
  { share: 0.62, width: 6, opacity: 0.08 },
  { share: 0.34, width: 10, opacity: 0.08 },
] as const;

/** Up the left end, over the corner, along the top and down into the right end. */
function topBorder(width: number, radius: number) {
  const left = PAD;
  const right = width - PAD;
  const r = Math.min(radius, (right - left) / 2);
  const d = `M ${left} ${PAD + r} A ${r} ${r} 0 0 1 ${left + r} ${PAD} L ${right - r} ${PAD} A ${r} ${r} 0 0 1 ${right} ${PAD + r}`;
  return { d, length: Math.PI * r + (right - left - 2 * r) };
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

export function AnsweringEdge({ active, radius }: { active: boolean; radius: number }) {
  const theme = useInkTheme();
  const reduced = useReduceMotion();
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  const shown = useSharedValue(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    shown.set(withTiming(active ? 1 : 0, { duration: active ? 200 : 360 }));
  }, [active, shown]);

  useEffect(() => {
    if (!active || reduced) {
      cancelAnimation(progress);
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

  const ring = useAnimatedStyle(() => ({ opacity: shown.get() }));
  // Faded at both ends, so it rises out of the field's left side and sinks into its right.
  const glow = useAnimatedStyle(() => ({ opacity: interpolate(progress.get(), [0, 0.06, 0.94, 1], [0, 1, 1, 0]) }));

  const ink = theme.color.accentLine;
  const height = radius + PAD * 2;
  const { d, length } = topBorder(width, radius);
  const glint = Math.max(72, Math.round(length * 0.36));

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="progressbar"
      accessibilityLabel={t('chat.stillAnswering')}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'yes' : 'no-hide-descendants'}
      style={[styles.edge, { height }, ring]}
    >
      {width > 0 ? (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Path d={d} fill="none" stroke={ink} strokeOpacity={reduced ? 0.9 : 0.4} strokeWidth={1.25} strokeLinecap="round" />
          {reduced ? <Path d={d} fill="none" stroke={ink} strokeOpacity={0.16} strokeWidth={6} strokeLinecap="round" /> : null}
        </Svg>
      ) : null}
      {width > 0 && !reduced ? (
        <Animated.View style={[StyleSheet.absoluteFill, glow]}>
          <Svg width={width} height={height}>
            {LAYERS.map((layer, i) => (
              <Layer key={i} d={d} length={length} glint={glint} color={ink} progress={progress} {...layer} />
            ))}
          </Svg>
        </Animated.View>
      ) : null}
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

/** What the note needs under the composer row: its line and a gap. */
export const NOTE_ROOM = 18;

const styles = StyleSheet.create({
  // Over the field's top border and the dock's padding above it: it moves nothing and overlaps no message.
  edge: { position: 'absolute', top: -PAD, left: -PAD, right: -PAD },
  note: { position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, alignItems: 'center' },
  noteText: { textAlign: 'center' },
});
