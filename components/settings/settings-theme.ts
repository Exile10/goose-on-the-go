/**
 * The grouped-list look shared by every Settings screen: a recessed page with raised groups on it,
 * drawn from Ink's palette so a setting looks the same wherever Ink draws its own controls.
 */

import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useInkTheme } from '@jarida/ink/native';

import { useTheme } from '@/providers/theme-provider';

export interface SettingsColors {
  page: string;
  group: string;
  line: string;
  pressed: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  danger: string;
  success: string;
}

export function useSettingsColors(): SettingsColors {
  const { color } = useInkTheme();
  const { isDark } = useTheme();
  return useMemo(
    () => ({
      // Ink's light page is warm white, too close to a white group to read as a recess.
      page: isDark ? color.bg : color.chrome,
      group: color.surface,
      line: color.line,
      pressed: color.pressed,
      text: color.text,
      textSecondary: color.textSecondary,
      textTertiary: color.textTertiary,
      accent: isDark ? color.accentLine : color.accent,
      danger: color.dangerFg,
      success: color.successFg,
    }),
    [color, isDark],
  );
}

/** `useThemedStyles` for the Settings palette: one sheet per palette, built outside render. */
export function useSettingsStyles<T extends StyleSheet.NamedStyles<T>>(factory: (c: SettingsColors) => T): T {
  const colors = useSettingsColors();
  return useMemo(() => StyleSheet.create(factory(colors)), [colors, factory]);
}
