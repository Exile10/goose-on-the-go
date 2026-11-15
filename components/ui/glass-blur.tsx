/**
 * The app's glass: expo-blur's `BlurView` under a light `surface` tint, as the tab bar wears it.
 *
 * Shaped for Ink's `blurComponent` slot (the tab bar passes it there) and usable on its own behind
 * any floating surface, such as the assist overlay's panel. A function rather than `BlurView`
 * itself: a class component's props must match the slot's exactly, and `BlurView` accepts more
 * tints than the two Ink passes.
 */

import { alpha } from '@jarida/ink';
import { useInkTheme } from '@jarida/ink/native';
import { BlurView } from 'expo-blur';
import React from 'react';

/**
 * How much of the `surface` tint sits over the blur.
 *
 * Ink derives ~0.50 light and ~0.64 dark: the least that keeps labels at 4.5:1 over any backdrop
 * with no blur at all. The glass is clearer than that by choice, and leans on the blur (Ink's, at
 * 60) for legibility. Raise this if labels struggle over busy content.
 */
export const GLASS_TINT_ALPHA = 0.3;

/**
 * The tint for glass over a backdrop that is not blurred at all and may be anything, such as
 * another app's busy home screen behind the assist overlay where the phone cannot blur it:
 * dense enough that body text reads over icons and photos, still letting the shapes behind show.
 */
export const GLASS_TINT_ALPHA_UNBLURRED = 0.86;

/** Ink's own blur strength for its floating bars. */
export const GLASS_INTENSITY = 60;

type GlassBlurProps = React.ComponentProps<typeof BlurView> & {
  /** How much `surface` sits over the blur; the tab bar's light glass unless given. */
  tintAlpha?: number;
};

export function GlassBlur({ style, tintAlpha = GLASS_TINT_ALPHA, ...props }: GlassBlurProps) {
  const theme = useInkTheme();
  return <BlurView {...props} style={[style, { backgroundColor: alpha(theme.color.surface, tintAlpha) }]} />;
}
