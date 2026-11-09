/**
 * A round, icon-only button for a screen header's actions.
 *
 * Ink's `InkButton` always carries a label and pads it, so beside an icon-only
 * control it reads as a full-width bar. On the Devices tab that put a broad
 * purple "Add a device" next to a small round Refresh, two actions of one rank
 * drawn at two sizes. This draws both at the same size: a circle at Ink's touch
 * floor, so the hit area is never below it.
 *
 *     primary    filled with the accent, glyph in the on-accent colour. The
 *                one action a header leads with.
 *     secondary  the surface colour with a hairline edge, glyph in the text
 *                colour. Everything else.
 *
 * Every colour is an Ink theme token, so it follows light and dark with the rest
 * of the app. There is no visible label, so `label` is required and becomes the
 * accessibility label.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { useInkTheme } from '@/components/ui/ink';

import type { IconName } from '@/constants/icons';
import { GIcon } from './g-icon';
import { GPressable } from './g-pressable';

/** Glyph size inside the circle: lucide's 24 grid read at a header's weight. */
const GLYPH = 20;

export interface GRoundButtonProps {
  icon: IconName;
  /** What the button does, read out by a screen reader in place of a visible label. */
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary';
  /** Work this button started is still running. */
  busy?: boolean;
}

export function GRoundButton({ icon, label, onPress, tone = 'secondary', busy = false }: GRoundButtonProps) {
  const theme = useInkTheme();
  const size = theme.touch.tapMin;
  const primary = tone === 'primary';

  return (
    <GPressable
      feedback="lift"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      style={[
        styles.round,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: primary ? theme.color.accent : theme.color.surface,
          // The same edge on both, so the filled one is not a hairline smaller.
          borderWidth: theme.edge.hairlineWidth,
          borderColor: primary ? theme.color.accent : theme.color.lineStrong,
        },
      ]}
    >
      <GIcon name={icon} size={GLYPH} color={primary ? theme.color.textOnAccent : theme.color.text} />
    </GPressable>
  );
}

const styles = StyleSheet.create({
  round: { alignItems: 'center', justifyContent: 'center' },
});
