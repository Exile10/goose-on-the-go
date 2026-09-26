/**
 * Build a StyleSheet from the active theme.
 *
 * `StyleSheet.create` runs once at module load, so a colour that has to flip
 * with the scheme cannot live in it. Define the factory at module scope and
 * pass it here: the sheet is rebuilt only when the scheme actually changes.
 *
 * @example
 *   const makeStyles = (c: ThemeColors) =>
 *     StyleSheet.create({ safe: { flex: 1, backgroundColor: c.background } });
 *
 *   function Screen() {
 *     const styles = useThemedStyles(makeStyles);
 *   }
 */

import { useMemo } from 'react';

import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/providers/theme-provider';

export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}
