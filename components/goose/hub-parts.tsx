/**
 * The small parts every My Goose screen shares: a section's head (a fact line, a big title that can
 * open the section, a muted line under it, and its menu), the link under a carousel, a round
 * control, and "34m ago".
 */

import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkText, inkText, useInkTheme } from '@jarida/ink/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { IconName } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { agoParts } from '@/models/news';
import { selectionTick } from '@/services/haptics';
import type { PullToRefresh } from '@/view-models/use-pull-to-refresh';

export function SectionHead({
  fact,
  title,
  subtitle,
  onOpen,
  openLabel,
  trailing,
  size = 'big',
}: {
  /** A line of fact over the title ("Updated 40m ago"), when there is one worth saying. */
  fact?: string | null;
  title: string;
  subtitle?: string | null;
  /** The title opens the section's own screen, and wears a chevron to say so. */
  onOpen?: () => void;
  openLabel?: string;
  trailing?: React.ReactNode;
  size?: 'big' | 'small';
}) {
  const theme = useInkTheme();
  const heading = inkText(theme, { role: 'display', size: size === 'big' ? '2xl' : 'lg', weight: 700, tracking: 'title', color: theme.color.text }).style;
  const titleRow = (
    <View style={styles.titleRow}>
      <Text style={heading} accessibilityRole="header" numberOfLines={2}>
        {title}
      </Text>
      {onOpen ? <GIcon name="chevron-right" size={size === 'big' ? 24 : 18} color={theme.color.textTertiary} strokeWidth={2.5} /> : null}
    </View>
  );
  return (
    <View style={styles.head}>
      <View style={styles.headWords}>
        {fact ? (
          <InkText size="sm" weight="semibold" tone="secondary">
            {fact}
          </InkText>
        ) : null}
        {onOpen ? (
          <GPressable
            onPress={() => {
              void selectionTick();
              onOpen();
            }}
            accessibilityRole="button"
            accessibilityLabel={openLabel ?? title}
            hitSlop={6}
          >
            {titleRow}
          </GPressable>
        ) : (
          titleRow
        )}
        {subtitle ? (
          <InkText size="md" tone="secondary">
            {subtitle}
          </InkText>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

/** "More ideas", under a carousel, at its right. */
export function MoreLink({ label, onPress, style }: { label: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const theme = useInkTheme();
  return (
    <GPressable
      onPress={() => {
        void selectionTick();
        onPress();
      }}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={8}
      style={[styles.more, style]}
    >
      <InkText size="md" weight="semibold" style={{ color: theme.color.accentLine }}>
        {label}
      </InkText>
      <GIcon name="chevron-right" size={16} color={theme.color.accentLine} strokeWidth={2.5} />
    </GPressable>
  );
}

/** A round control: a section's menu, a reader's way back. Opaque chrome, never the edge. */
export function RoundButton({
  icon,
  label,
  onPress,
  size = 36,
  style,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useInkTheme();
  return (
    <GPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={(44 - size) / 2 > 0 ? (44 - size) / 2 : 0}
      style={[
        styles.round,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.color.chrome, borderColor: theme.color.lineStrong },
        style,
      ]}
    >
      <GIcon name={icon} size={Math.round(size * 0.5)} color={theme.color.text} />
    </GPressable>
  );
}

/** "34m ago", "5h ago", "2d ago", then the date. */
export function useAgo(): (iso: string | null) => string | null {
  const { t, i18n } = useTranslation();
  return (iso) => {
    if (!iso) return null;
    const { unit, value } = agoParts(iso, new Date());
    switch (unit) {
      case 'now':
        return t('goose.ago.now');
      case 'm':
        return t('goose.ago.minutes', { count: value });
      case 'h':
        return t('goose.ago.hours', { count: value });
      case 'd':
        return t('goose.ago.days', { count: value });
      case 'date':
        return new Date(value).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
    }
  };
}

/** A gap between a screen's sections that says "new subject" without a rule. */
export function SectionGap() {
  return <View style={styles.gap} />;
}

/** A hub screen's scroll: the page's ground, the gutter, a pull to read again, room at the foot. */
export function ScreenScroll({ pull, children, gap = Spacing['2xl'], top = Spacing.lg }: { pull?: PullToRefresh; children: React.ReactNode; gap?: number; top?: number }) {
  const theme = useInkTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.color.bg }}
      contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingTop: top, paddingBottom: insets.bottom + Spacing['3xl'], gap }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={pull ? <RefreshControl {...pull} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.md },
  headWords: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  trailing: { paddingBottom: 2 },
  more: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 2, paddingVertical: Spacing.xs },
  round: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  gap: { height: Spacing.md },
});
