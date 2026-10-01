/**
 * The Chat tab: the wall of conversations, and nothing pushed inside it.
 *
 * The wall is the first screen, as it is on the desktop. A conversation opens
 * over the whole app rather than inside this tab — `app/conversation.tsx`, on
 * the root stack — so it has the screen to itself, with no bar under its
 * composer. Back, the edge swipe or Android's button, returns here to the same
 * place on the wall rather than to its top.
 *
 * It stays a directory with a layout of its own so the tab is still the route
 * named `chat`, which is the key the tab bar navigates by.
 */

import { Stack } from 'expo-router';
import React from 'react';

import { useTheme } from '@/providers/theme-provider';

export default function ChatLayout() {
  // A navigator's own surface is out of `useThemedStyles`' reach, exactly as
  // the (stack) header is, so it reads the theme directly.
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
