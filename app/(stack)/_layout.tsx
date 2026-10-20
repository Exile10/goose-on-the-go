/**
 * StackLayout — the screens reached from the Profile hub and from Home.
 *
 * The header is drawn by the navigator rather than by any screen, so it is the
 * one surface `useThemedStyles` cannot reach. It reads `useTheme()` directly;
 * without that it stayed `Brand.white` in dark mode, which is a white slab
 * above every one of these screens.
 */

import { Stack, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { useTheme } from '@/providers/theme-provider';
import { selectionTick } from '@/services/haptics';
import { JaridaPurple } from '@/constants/colors';
import { FontFamily } from '@/constants/typography';

/**
 * A back control the navigator will not draw on its own.
 *
 * These screens are pushed from the tab group through the *root* stack, so this
 * nested navigator has exactly one entry in its own history and suppresses the
 * system back button. Without this, every one of them is a dead end reachable
 * only by the edge-swipe gesture — which is invisible, and which a person who
 * has turned it off does not have at all.
 */
function BackButton() {
  const router = useRouter();
  const { t } = useTranslation();
  const onPress = useCallback(() => {
    void selectionTick();
    router.back();
  }, [router]);

  return (
    <GPressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
    >
      <GIcon name="chevron-left" size={22} color={JaridaPurple[500]} />
    </GPressable>
  );
}

export default function StackLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: JaridaPurple[500],
        headerTitleStyle: {
          color: colors.text,
          fontFamily: FontFamily.heading,
          fontWeight: '700',
        },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        headerLeft: () => <BackButton />,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="settings-assistant" options={{ title: t('screens.settingsAssistant') }} />
      <Stack.Screen name="settings-voice" options={{ title: t('screens.settingsVoice') }} />
      <Stack.Screen name="settings-speaking" options={{ title: t('screens.settingsSpeaking') }} />
      <Stack.Screen name="wake-word" options={{ title: t('screens.wakeWord') }} />
      <Stack.Screen name="settings-listening" options={{ title: t('screens.settingsListening') }} />
      <Stack.Screen name="settings-thinking" options={{ title: t('screens.settingsThinking') }} />
      <Stack.Screen name="settings-memory" options={{ title: t('screens.settingsMemory') }} />
      <Stack.Screen name="settings-memory-tuning" options={{ title: t('screens.settingsMemoryTuning') }} />
      <Stack.Screen name="settings-tools" options={{ title: t('screens.settingsTools') }} />
      <Stack.Screen name="settings-internet" options={{ title: t('screens.settingsInternet') }} />
      <Stack.Screen name="settings-home" options={{ title: t('screens.settingsHome') }} />
      <Stack.Screen name="settings-timezone" options={{ title: t('screens.settingsTimezone') }} />
      <Stack.Screen name="settings-issue" options={{ title: t('screens.settingsIssue') }} />
      <Stack.Screen name="settings-household" options={{ title: t('screens.settingsHousehold') }} />
      <Stack.Screen name="settings-cameras" options={{ title: t('screens.settingsCameras') }} />
      <Stack.Screen name="settings-announcements" options={{ title: t('screens.settingsAnnouncements') }} />
      <Stack.Screen name="settings-privacy" options={{ title: t('screens.settingsPrivacy') }} />
      <Stack.Screen name="settings-retention" options={{ title: t('screens.settingsRetention') }} />
      <Stack.Screen name="settings-appearance" options={{ title: t('screens.settingsAppearance') }} />
      <Stack.Screen name="settings-advanced" options={{ title: t('screens.settingsAdvanced') }} />
      <Stack.Screen name="models" options={{ title: t('screens.models') }} />
      <Stack.Screen name="settings-model-role" options={{ title: t('screens.settingsModelRole') }} />
      <Stack.Screen name="settings-model" options={{ title: t('screens.settingsModel') }} />
      <Stack.Screen name="settings-model-catalog" options={{ title: t('screens.settingsModelCatalog') }} />
      <Stack.Screen name="settings-model-search" options={{ title: t('screens.settingsModelSearch') }} />
      <Stack.Screen name="memories" options={{ title: t('screens.memories') }} />
      <Stack.Screen name="sessions" options={{ title: t('screens.sessions') }} />
      <Stack.Screen name="logs" options={{ title: t('screens.logs') }} />
      <Stack.Screen name="schedule" options={{ title: t('screens.schedule') }} />
      <Stack.Screen name="schedule-detail" options={{ title: t('screens.scheduleDetail') }} />
      <Stack.Screen name="ride" options={{ title: t('screens.ride') }} />
      <Stack.Screen name="extensions" options={{ title: t('screens.extensions') }} />
      <Stack.Screen name="web-search" options={{ title: t('screens.webSearch') }} />
      <Stack.Screen name="add-users" options={{ title: t('screens.addUsers') }} />
      <Stack.Screen name="privacy" options={{ title: t('screens.privacy') }} />
      <Stack.Screen name="remote-access" options={{ title: t('screens.remoteAccess') }} />
      <Stack.Screen name="home-management" options={{ title: t('screens.homeManagement') }} />
      <Stack.Screen name="pond-pairing" options={{ title: t('screens.pondPairing') }} />
      <Stack.Screen name="developer" options={{ title: t('screens.developer') }} />
      <Stack.Screen name="commission-device" options={{ title: t('screens.commissionDevice') }} />
      <Stack.Screen name="switch-pond" options={{ title: t('screens.switchPond') }} />
      <Stack.Screen
        name="connect-desktop"
        options={{
          // No header at all. `headerTransparent` still reserved a bar, with the
          // tint on top of it, which is why the title was invisible and the
          // camera started an inch down the screen. A viewfinder wants the whole
          // screen, so it carries its own dismiss control instead.
          headerShown: false,
        }}
      />
    </Stack>
  );
}
