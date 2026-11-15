/**
 * AssistRoot — the root of the assist overlay's own React tree.
 *
 * `AssistActivity` (plugins/pond-assist/PondAssist.kt) renders the component `index.ts` registers
 * as `assist`, a second surface beside the app's `main`. It shares the JavaScript runtime with the
 * app but not its tree, so it carries what the overlay draws with: the translations, Ink's icons
 * and theme, the safe area and the body font. It has no router and no ServerProvider; the
 * overlay reaches the Pond through `useAssist`. See docs/ASSISTANT.md.
 */

import React, { useEffect } from 'react';
import { useFonts } from 'expo-font';
import { InkProvider } from '@/components/ui/ink';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AssistOverlay } from '@/components/assist/assist-overlay';
// Registers the app's icons with Ink, as the app's own root does.
import '@/components/ui/ink-icons';
// Initialises i18next before the overlay renders.
import '@/services/i18n';
import { ThemeProvider, useTheme } from '@/providers/theme-provider';
import { loadHapticsPreference } from '@/services/haptics';

function ThemedOverlay() {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <InkProvider scheme={isDark ? 'dark' : 'light'} accent="Purple" insets={insets}>
      <AssistOverlay />
    </InkProvider>
  );
}

export function AssistRoot() {
  // The body face only: the overlay draws nothing in the others. Already loaded when the app is
  // running; on a cold start a failure costs the overlay its typeface, not its use.
  const [fontsLoaded, fontError] = useFonts({ Quicksand: require('../../assets/fonts/Quicksand.ttf') });

  useEffect(() => {
    void loadHapticsPreference();
  }, []);

  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedOverlay />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
