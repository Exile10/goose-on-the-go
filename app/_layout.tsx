/**
 * Root Layout — loads brand fonts, manages splash screen,
 * and wraps the app tree with ThemeProvider + ServerProvider.
 */

import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { NotificationsProvider } from '@/providers/notifications-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import { ServerProvider } from '@/providers/server-provider';

/** Keep splash visible while fonts load */
SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  const [fontsLoaded, fontError] = useFonts({
    Quicksand: require('../assets/fonts/Quicksand.ttf'),
    Comfortaa: require('../assets/fonts/Comfortaa.ttf'),
    'JetBrainsMono-Regular': require('../assets/fonts/JetBrainsMono-Regular.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ThemeProvider>
      <ServerProvider>
        <NotificationsProvider>
          <NavThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="(stack)" options={{ headerShown: false }} />
              <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
            </Stack>
            <StatusBar style="auto" />
          </NavThemeProvider>
        </NotificationsProvider>
      </ServerProvider>
    </ThemeProvider>
  );
}
