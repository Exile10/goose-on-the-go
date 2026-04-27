/**
 * ThemeProvider — exposes Jarida color tokens resolved for the current scheme.
 *
 * Wraps the app so any component can call `useTheme()` to get
 * the active `colors` object and `colorScheme`.
 */

import React, { createContext, useContext, useMemo, type PropsWithChildren } from 'react';

import { Colors, type ThemeColors } from '@/constants/colors';
import { useColorScheme } from '@/hooks/use-color-scheme';

type ColorScheme = 'light' | 'dark';

interface ThemeContextValue {
  /** Resolved color tokens for the active scheme */
  colors: ThemeColors;
  /** Current color scheme */
  colorScheme: ColorScheme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const colorScheme: ColorScheme = systemScheme ?? 'light';

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: Colors[colorScheme],
      colorScheme,
    }),
    [colorScheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Access the current theme colors and scheme.
 * Must be called within a `<ThemeProvider>`.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return ctx;
}
