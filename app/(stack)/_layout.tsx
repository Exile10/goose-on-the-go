/**
 * StackLayout — Sub-screen navigation for all profile hub destinations.
 *
 * 15 screens matching Goose On The Go v2 design.
 */

import { Stack } from 'expo-router';
import React from 'react';

import { Brand, Grey, JaridaPurple } from '@/constants/colors';
import i18n from '@/services/i18n';

export default function StackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: Brand.white },
        headerTintColor: JaridaPurple[500],
        headerTitleStyle: { color: Grey[900], fontFamily: 'Quicksand', fontWeight: '700' },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="models" options={{ title: i18n.t('nav.models') }} />
      <Stack.Screen name="memories" options={{ title: i18n.t('nav.memories') }} />
      <Stack.Screen name="logs" options={{ title: i18n.t('nav.logs') }} />
      <Stack.Screen name="schedule" options={{ title: i18n.t('nav.schedule') }} />
      <Stack.Screen name="app-management" options={{ title: i18n.t('nav.appManagement') }} />
      <Stack.Screen name="mcp-servers" options={{ title: i18n.t('nav.mcpServers') }} />
      <Stack.Screen name="add-users" options={{ title: i18n.t('nav.addUsers') }} />
      <Stack.Screen name="biometrics" options={{ title: i18n.t('screens.biometrics') }} />
      <Stack.Screen name="privacy" options={{ title: i18n.t('nav.privacy') }} />
      <Stack.Screen name="remote-access" options={{ title: i18n.t('nav.remoteAccess') }} />
      <Stack.Screen name="home-management" options={{ title: i18n.t('nav.homeManagement') }} />
      <Stack.Screen name="pond-pairing" options={{ title: i18n.t('screens.pondPairing') }} />
      <Stack.Screen name="developer" options={{ title: i18n.t('screens.developer') }} />
      <Stack.Screen name="commission-device" options={{ title: i18n.t('commission.addDevice') }} />
      <Stack.Screen
        name="connect-desktop"
        options={{
          // No header at all. `headerTransparent` still reserved a white bar
          // against the light navigation theme -- with a white tint on top of
          // it, which is why the title was invisible and the camera started an
          // inch down the screen. A viewfinder wants the whole screen, so the
          // screen carries its own dismiss control instead.
          headerShown: false,
        }}
      />
    </Stack>
  );
}
