/**
 * A featured carousel: large portrait cards, each with a tinted band saying what kind of thing it is,
 * a full-bleed picture, a bold two-line title and one line of fact (a time, a price).
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { InkCard, InkText, useInkTheme } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { IconName } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { HubPicture } from './hub-picture';

export const PORTRAIT_WIDTH = 236;

export function PortraitCard({
  band,
  bandIcon,
  picture,
  title,
  meta,
  metaIcon,
  metaTone,
  onPress,
  accessibilityLabel,
  pictureIcon = 'photo',
}: {
  band: string;
  bandIcon: IconName;
  picture: string | null;
  title: string;
  meta?: string | null;
  metaIcon?: IconName;
  /** A meta line that is good news (a price drop) or needs a look (a page that will not load). */
  metaTone?: 'good' | 'warn' | null;
  onPress: () => void;
  accessibilityLabel?: string;
  pictureIcon?: IconName;
}) {
  const theme = useInkTheme();
  const metaColor = metaTone === 'good' ? theme.color.successFg : metaTone === 'warn' ? theme.color.warningFg : theme.color.textSecondary;
  return (
    <GPressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} style={{ width: PORTRAIT_WIDTH }}>
      <InkCard contentStyle={styles.flush}>
        <View style={[styles.band, { backgroundColor: theme.color.brandSoft, borderBottomColor: theme.color.line }]}>
          <InkText size="sm" weight="semibold" numberOfLines={1} style={{ flex: 1, color: theme.color.accentLine }}>
            {band}
          </InkText>
          <GIcon name={bandIcon} size={16} color={theme.color.accentLine} />
        </View>
        <HubPicture path={picture} label={title} style={styles.picture} icon={pictureIcon} iconSize={34} />
        <View style={styles.words}>
          <InkText size="md" weight="bold" numberOfLines={2}>
            {title}
          </InkText>
          {meta ? (
            <View style={styles.meta}>
              {metaIcon ? <GIcon name={metaIcon} size={14} color={metaColor} /> : null}
              <InkText size="sm" weight="semibold" numberOfLines={1} style={{ color: metaColor }}>
                {meta}
              </InkText>
            </View>
          ) : null}
        </View>
      </InkCard>
    </GPressable>
  );
}

export function Carousel({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.row} decelerationRate="fast" snapToInterval={PORTRAIT_WIDTH + Spacing.md} snapToAlignment="start">
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flush: { padding: 0, gap: 0, overflow: 'hidden' },
  band: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  picture: { width: '100%', height: 200 },
  words: { padding: Spacing.md, gap: 6, minHeight: 92 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bleed: { marginHorizontal: -Spacing.lg },
  row: { gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xs },
});
