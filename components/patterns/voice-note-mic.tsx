/**
 * The composer's microphone. A tap opens voice mode, as it always has; a hold records a voice note,
 * sent on letting go, or dropped by sliding left past the line first.
 */

import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { glassLift } from '@jarida/ink';
import { inkText, useInkTheme, useReduceMotion } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';

/** How far left the finger travels before letting go drops the note instead of sending it. */
export const CANCEL_DISTANCE = 96;
/** Long enough that a tap never records, short enough that a hold feels immediate. */
const HOLD_MS = 220;

export interface VoiceNoteMicProps {
  size: number;
  recording: boolean;
  onTap: () => void;
  onHold: () => void;
  onRelease: () => void;
  onCancel: () => void;
  /** The finger crossed the cancel line, either way. */
  onPastLine: (past: boolean) => void;
  style?: StyleProp<ViewStyle>;
}

export function VoiceNoteMic({ size, recording, onTap, onHold, onRelease, onCancel, onPastLine, style }: VoiceNoteMicProps) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const reduced = useReduceMotion();
  const slide = useSharedValue(0);
  const past = useSharedValue(false);

  const hold = Gesture.Pan()
    .activateAfterLongPress(HOLD_MS)
    .onStart(() => {
      slide.set(0);
      past.set(false);
      scheduleOnRN(onHold);
    })
    .onUpdate((e) => {
      const x = Math.min(0, e.translationX);
      slide.set(x);
      const beyond = x < -CANCEL_DISTANCE;
      if (beyond !== past.get()) {
        past.set(beyond);
        scheduleOnRN(onPastLine, beyond);
      }
    })
    .onEnd((_e, success) => {
      scheduleOnRN(success && !past.get() ? onRelease : onCancel);
    })
    .onFinalize(() => {
      slide.set(withTiming(0, { duration: 160 }));
      past.set(false);
    });
  const tap = Gesture.Tap()
    .maxDuration(HOLD_MS + 400)
    .onEnd((_e, success) => {
      if (success) scheduleOnRN(onTap);
    });

  const motion = useAnimatedStyle(() => ({
    transform: [
      { translateX: slide.get() },
      { scale: reduced ? 1 : withSpring(recording ? 1.3 : 1, { damping: 16, stiffness: 260 }) },
    ],
  }));

  const face = recording
    ? { backgroundColor: theme.color.accent, borderColor: theme.color.accent, borderWidth: theme.edge.hairlineWidth }
    : { backgroundColor: theme.color.chrome, borderColor: theme.color.lineStrong, borderWidth: theme.edge.hairlineWidth };

  // A root of its own, as the widget board has: the app's root carries none, and adding one there
  // would change how every screen's touches are handled for the sake of one button. Sized to the
  // button, because unstyled it defaults to flex: 1 and takes half the composer's row.
  return (
    <GestureHandlerRootView style={[{ width: size, height: size }, style]}>
      <GestureDetector gesture={Gesture.Exclusive(hold, tap)}>
        <Animated.View
          accessible
          accessibilityRole="button"
          accessibilityLabel={t('chat.voice.open')}
          accessibilityHint={t('chat.voiceNote.holdHint')}
          onAccessibilityTap={onTap}
          style={[
            styles.control,
            { width: size, height: size, borderRadius: size / 2 },
            face,
            recording ? null : glassLift(theme),
            motion,
          ]}
        >
          <GIcon name="mic" size={20} color={recording ? theme.color.textOnAccent : theme.color.text} />
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

/** m:ss, as a recorder reads. */
export function clockWords(ms: number): string {
  const secs = Math.floor(ms / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/** Stands in the field's place while a note records: the time so far, and how to drop it. */
export function VoiceNoteStrip({ elapsedMs, level, past }: { elapsedMs: number; level: number; past: boolean }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const dot = useAnimatedStyle(() => ({ transform: [{ scale: withTiming(1 + Math.min(1, level) * 0.6, { duration: 80 }) }] }));
  const words = inkText(theme, { size: 'md', color: past ? theme.color.dangerFg : theme.color.textSecondary });
  const clock = inkText(theme, { role: 'mono', size: 'md', color: theme.color.text });
  return (
    <View style={styles.strip} accessibilityLiveRegion="polite">
      <Animated.View style={[styles.dot, { backgroundColor: theme.color.dangerFg }, dot]} />
      <Text style={clock.style}>{clockWords(elapsedMs)}</Text>
      <Text style={[words.style, styles.hint]} numberOfLines={1}>
        {past ? t('chat.voiceNote.releaseToCancel') : t('chat.voiceNote.slideToCancel')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  control: { alignItems: 'center', justifyContent: 'center' },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  hint: { flex: 1, textAlign: 'right' },
});
