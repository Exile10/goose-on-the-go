/**
 * The page every Settings screen scrolls on. One gutter and one set of insets for all of them, so
 * no page sits a few points off the one before it, as they did when each wrote its own.
 */

import React, { useMemo, type ReactElement, type ReactNode } from 'react';
import { ScrollView, View, type RefreshControlProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InkNotice } from '@jarida/ink/native';

import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import { Spacing } from '@/constants/spacing';
import { useSettingsColors } from './settings-theme';

/** The side gutter: cards, headers and footers all line up on it. */
export const PAGE_GUTTER = Spacing.lg;

/** The page's padding, for a list that cannot be a `SettingsScroll`, such as a long `FlatList`. */
export function useSettingsPagePadding(): ViewStyle {
  const insets = useSafeAreaInsets();
  return useMemo(
    () => ({ paddingHorizontal: PAGE_GUTTER, paddingTop: Spacing.lg, paddingBottom: insets.bottom + Spacing['4xl'] }),
    [insets.bottom],
  );
}

export function SettingsScroll({
  children,
  refreshControl,
  typing,
}: {
  children: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
  /** The page has fields: keep taps on them, and let the keyboard push the page up. */
  typing?: boolean;
}) {
  const colors = useSettingsColors();
  const padding = useSettingsPagePadding();
  const scroll = (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.page }}
      contentContainerStyle={padding}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps={typing ? 'handled' : undefined}
      keyboardDismissMode={typing ? 'interactive' : undefined}
    >
      {children}
    </ScrollView>
  );
  return typing ? <GKeyboardView style={{ flex: 1, backgroundColor: colors.page }}>{scroll}</GKeyboardView> : scroll;
}

/** A notice on the page, spaced as a group is, so it never sits flush against the card below. */
export function SettingsNotice({ tone, children }: { tone: 'neutral' | 'danger' | 'warning' | 'success'; children: ReactNode }) {
  return (
    <View style={{ marginBottom: Spacing.xl }}>
      <InkNotice tone={tone}>{children}</InkNotice>
    </View>
  );
}
