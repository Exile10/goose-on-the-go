/**
 * Jarida Design System — Typography Tokens
 *
 * Brand fonts: Quicksand (primary), Comfortaa (alt), JetBrains Mono (code).
 * Loaded via expo-font in the root layout.
 */

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
