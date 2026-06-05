/**
 * useThemeColor — resolve a single Jarida color token for the active scheme.
 *
 * Accepts optional per-scheme overrides via `props`. Falls back to the
 * token value from LightColors / DarkColors.
 */

import { Colors, type ThemeColors } from '@/constants/colors';
import { useColorScheme } from '@/hooks/use-color-scheme';

type ThemeColorName = keyof ThemeColors;

/**
 * Returns the resolved color string for `colorName` under the current scheme.
 * If `props.light` or `props.dark` is provided, that override takes precedence.
 */
export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: ThemeColorName,
): string {
  // RN 0.85's useColorScheme may return 'unspecified'; collapse to light/dark.
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const override = props[scheme];

  return override ?? Colors[scheme][colorName];
}
