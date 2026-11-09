/**
 * The page every Settings screen scrolls on. One gutter and one set of insets for all of them, so
 * no page sits a few points off the one before it, as they did when each wrote its own.
 */

import React, { useMemo, type ReactElement, type ReactNode } from 'react';
import { ScrollView, View, type RefreshControlProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InkNotice } from '@/components/ui/ink';

import { GKeyboardScrollView } from '@/components/ui/g-keyboard-view';
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
  /** The page has fields: keep taps on them, lift the page clear of the keyboard, and scroll the field being typed in above it. */
  typing?: boolean;
}) {
  const colors = useSettingsColors();
  const padding = useSettingsPagePadding();
  const page = { flex: 1, backgroundColor: colors.page };
  return typing ? (
    <GKeyboardScrollView containerStyle={page} style={page} contentContainerStyle={padding} refreshControl={refreshControl} keyboardDismissMode="interactive">
      {children}
    </GKeyboardScrollView>
  ) : (
    <ScrollView style={page} contentContainerStyle={padding} refreshControl={refreshControl}>
      {children}
    </ScrollView>
  );
}

/** A notice on the page, spaced as a group is, so it never sits flush against the card below. */
export function SettingsNotice({ tone, children }: { tone: 'neutral' | 'danger' | 'warning' | 'success'; children: ReactNode }) {
  return (
    <View style={{ marginBottom: Spacing.xl }}>
      <InkNotice tone={tone}>{children}</InkNotice>
    </View>
  );
}
