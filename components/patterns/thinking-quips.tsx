/**
 * ThinkingQuips — what shows while Goose has not written anything yet.
 *
 * Two lines. The upper one is what the Pond says it is doing — "Checking the
 * weather…" when a tool is running, "Agent working..." between — which is
 * the true part, and only appears once the Pond has said something. The lower
 * one is a quip, turning over every few seconds, which is the part that says
 * the wait is alive. pond-desktop's `ThinkingPlaceholder`, and its timing: a
 * new quip every 2.8s with a 300ms fade, starting somewhere random and walking
 * forward so the same one does not come round twice in a row.
 *
 * Reduced motion keeps the quip still. It changes a word under someone who
 * asked for less movement, and the status line above already says the turn is
 * alive.
 */

import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { inkText, useInkTheme, useReduceMotion } from '@/components/ui/ink';

import { quipKey, THINKING_QUIPS } from '@/constants/quips';

const INTERVAL_MS = 2800;
const FADE_MS = 300;

export function ThinkingQuips({ status, seed }: { status: string | null; seed: number }) {
  const theme = useInkTheme();
  const reduced = useReduceMotion();
  const { t } = useTranslation();
  const [index, setIndex] = useState(() => Math.abs(Math.trunc(seed)) % THINKING_QUIPS);
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        setIndex((i) => (i + 1) % THINKING_QUIPS);
        Animated.timing(opacity, {
          toValue: 1,
          duration: FADE_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }).start();
      });
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [opacity, reduced]);

  const line = inkText(theme, { size: 'sm', color: theme.color.textSecondary });
  const quip = inkText(theme, { size: 'sm', color: theme.color.textTertiary });

  return (
    <View
      style={styles.wrap}
      accessibilityRole="progressbar"
      accessibilityLabel={status ?? t('chat.thinking')}
      accessibilityLiveRegion="polite"
    >
      {status ? <Animated.Text style={[line.style, styles.italic]}>{status}</Animated.Text> : null}
      <Animated.Text style={[quip.style, styles.italic, { opacity }]} importantForAccessibility="no">
        {t(quipKey('thinking', index))}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2, paddingVertical: 4 },
  // A synthesised oblique: Quicksand has no italic face, and on this line the
  // slant is a tone of voice, not the display title's signature.
  italic: { fontStyle: 'italic' },
});
