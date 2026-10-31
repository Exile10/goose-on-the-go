/**
 * Jarida Design System — Typography Tokens
 *
 * Brand fonts: Quicksand (primary), Comfortaa (alt), JetBrains Mono (code).
 * Loaded via expo-font in the root layout.
 */

import { resolveFont } from '@jarida/ink';

export const FontFamily = {
  display: 'Quicksand',
  heading: 'Quicksand',
  body: 'Quicksand',
  bodyAlt: 'Comfortaa',
  mono: 'JetBrainsMono-Regular',
} as const;

/** Font sizes — slightly bumped for mobile readability */
export const FontSize = {
  xs: 10,
  sm: 12,
  base: 14,
  md: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
  '5xl': 48,
} as const;

export const FontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const LineHeight = {
  tight: 1.15,
  snug: 1.25,
  normal: 1.5,
  loose: 1.7,
} as const;

export const LetterSpacing = {
  tight: -0.02,
  snug: -0.01,
  normal: 0,
  wide: 0.08,
  wider: 0.12,
} as const;

/**
 * The registered file for a weight, as `{ fontFamily }`. Android draws a
 * `fontWeight` on a custom family in its regular face, so a heading set as
 * Quicksand at 600 came out thin there; naming the weight's own file is what
 * Ink's text does, and what keeps these screens the same weight as its controls.
 */
export function face(
  role: 'display' | 'body' | 'mono',
  weight: keyof typeof FontWeight = 'regular',
): { fontFamily: string } {
  const w = Number(FontWeight[weight]) as 400 | 500 | 600 | 700;
  return { fontFamily: resolveFont('native', { role, weight: w }).fontFamily };
}
