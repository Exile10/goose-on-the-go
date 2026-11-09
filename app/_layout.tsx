/**
 * Root Layout — loads brand fonts, manages splash screen,
 * and wraps the app tree with ThemeProvider + ServerProvider.
 */

import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { loadAsync as loadFontsAsync, useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';
import {
  Quicksand_400Regular,
  Quicksand_500Medium,
  Quicksand_600SemiBold,
  Quicksand_700Bold,
} from '@expo-google-fonts/quicksand';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import { InkProvider } from '@jarida/ink/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectionStatus } from '@/components/patterns/connection-status';
import { NotificationsProvider } from '@/providers/notifications-provider';
import { ThemeProvider, useTheme } from '@/providers/theme-provider';
// Registers the app's icons with Ink. Imported for the side effect: on native
// every Ink `icon=` slot draws an empty gap until something is registered.
import '@/components/ui/ink-icons';
// Initialises i18next before the first screen renders.
import '@/services/i18n';
import { ServerProvider } from '@/providers/server-provider';
import { ConfirmProvider } from '@/providers/confirm-provider';
import { SnackbarProvider } from '@/providers/snackbar-provider';
import { loadHapticsPreference } from '@/services/haptics';
import { resumePhoneWake } from '@/services/phone-wake';
import { loadReplyNoticePreference } from '@/services/reply-notices';

/**
 * Keep the splash up until the app can draw itself.
 *
 * "Can draw itself" used to mean all three brand fonts had parsed — 586 KB of
 * TTF, on the one serial step before first paint. Two of them are not on it:
 * `FontFamily.mono` (JetBrains Mono, 267 KB) appears only on stack screens the
 * user reaches later, and `FontFamily.bodyAlt` (Comfortaa, 197 KB) is a
 * design-system token nothing references yet. Only Quicksand, at 122 KB, is on
 * every first screen.
 *
 * So the splash now waits on Quicksand alone and the other two load behind it,
 * arriving long before anything asks for them.
 */
SplashScreen.preventAutoHideAsync();

/**
 * Loaded behind the splash — see above for why none of these gate first paint.
 *
 * `@jarida/ink` resolves a weight to one exact registered family name, because
 * Android ignores `fontWeight` (see requiredNativeFonts() in
 * @jarida/ink/dist/core/font.js). An unregistered name is not an error there —
 * React Native falls back to the system face — so these belong behind the
 * splash with the rest rather than in front of it. An ink control drawn in the
 * first frames is briefly system-faced and then correct, which is the same
 * trade the two fonts below already make.
 */
const DEFERRED_FONTS = {
  Comfortaa: require('../assets/fonts/Comfortaa.ttf'),
  'JetBrainsMono-Regular': require('../assets/fonts/JetBrainsMono-Regular.ttf'),
  Quicksand_400Regular,
  Quicksand_500Medium,
  Quicksand_600SemiBold,
  Quicksand_700Bold,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
};

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {

  const [fontsLoaded, fontError] = useFonts({
    Quicksand: require('../assets/fonts/Quicksand.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Deliberately not awaited and deliberately not a splash gate: a screen that
  // wants one of these is several taps away, and a font that fails to load
  // costs that screen its typeface, not the app its launch.
  useEffect(() => {
    loadFontsAsync(DEFERRED_FONTS).catch((e) =>
      console.warn('[fonts] deferred fonts failed to load', e),
    );
    void loadHapticsPreference();
    void loadReplyNoticePreference();
    // Android starts the wake-word service only while the app is in front, so a reboot ends it
    // until the app opens again: this is that moment.
    void resumePhoneWake();
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ThemeProvider>
      <ServerProvider>
        <NotificationsProvider>
          <ThemedApp />
        </NotificationsProvider>
      </ServerProvider>
    </ThemeProvider>
  );
}


/**
 * Sits inside ThemeProvider so Navigation and Ink derive from the same resolved
 * scheme rather than each reading the system on its own.
 */
function ThemedApp() {
  const { isDark } = useTheme();
  // Ink cannot measure the notch or the home indicator itself; told once here,
  // every sheet, toast and bar clears them.
  const insets = useSafeAreaInsets();
  return (
    <NavThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <InkProvider scheme={isDark ? 'dark' : 'light'} accent="Purple" insets={insets}>
        {/* Inside Ink because the dialog and the snackbar draw with its theme; around every screen
            so any of them can ask. */}
        <SnackbarProvider>
          <ConfirmProvider>
            <ConnectionStatus />
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="(stack)" options={{ headerShown: false }} />
              <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
              {/* Over the tabs rather than inside one, so a conversation has the
                  whole screen: no bar under the composer. It draws its own header. */}
              <Stack.Screen name="conversation" options={{ headerShown: false }} />
              {/* Over everything, with its own close control: five sentences need the whole screen. */}
              <Stack.Screen name="teach-voice" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }} />
              <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
            </Stack>
            <StatusBar style={isDark ? 'light' : 'dark'} />
          </ConfirmProvider>
        </SnackbarProvider>
      </InkProvider>
    </NavThemeProvider>
  );
}
