/**
 * Grouped lists for what the member follows and keeps: a rounded hairline group, each row a glyph
 * or a picture tile, its label and a chevron, with dividers that start past the tile. A group can
 * fold away under its own heading, and in Edit its rows take their own controls instead.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { InkEdge, InkText, inkText, useInkTheme } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { IconName } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { selectionTick } from '@/services/haptics';
import { HubPicture } from './hub-picture';

const TILE = 36;

export function GroupHeading({ title, folded, onToggle }: { title: string; folded?: boolean; onToggle?: () => void }) {
  const theme = useInkTheme();
  const heading = inkText(theme, { role: 'display', size: 'xl', weight: 700, tracking: 'title', color: theme.color.text }).style;
  const body = (
    <View style={styles.heading}>
      <Text style={heading} accessibilityRole="header">
        {title}
      </Text>
      {onToggle ? <GIcon name={folded ? 'chevron-right' : 'chevron'} size={20} color={theme.color.textTertiary} strokeWidth={2.5} /> : null}
    </View>
  );
  if (!onToggle) return body;
  return (
    <GPressable
      onPress={() => {
        void selectionTick();
        onToggle();
      }}
      accessibilityRole="button"
      accessibilityState={{ expanded: !folded }}
      accessibilityLabel={title}
    >
      {body}
    </GPressable>
  );
}

export function InsetGroup({ children }: { children: React.ReactNode }) {
  return (
    <InkEdge raised={false} contentStyle={styles.group}>
      {children}
    </InkEdge>
  );
}

export function GroupRow({
  icon,
  picture,
  initial,
  label,
  detail,
  value,
  onPress,
  first,
  trailing,
  muted,
}: {
  icon?: IconName;
  /** A picture tile instead of a glyph: the Pond's path, else the topic's initial. */
  picture?: string | null;
  initial?: string;
  label: string;
  detail?: string | null;
  value?: string | null;
  onPress?: () => void;
  first?: boolean;
  /** Replaces the chevron: Edit's own controls. */
  trailing?: React.ReactNode;
  muted?: boolean;
}) {
  const theme = useInkTheme();
  const tile =
    picture !== undefined || initial ? (
      picture ? (
        <HubPicture path={picture} label={label} style={[styles.tile, { borderRadius: theme.radius.sm }]} iconSize={16} />
      ) : (
        <View style={[styles.tile, styles.center, { borderRadius: theme.radius.sm, backgroundColor: theme.color.accentSoft }]}>
          <Text style={inkText(theme, { role: 'display', size: 'md', weight: 700, color: theme.color.accentLine }).style}>{initial}</Text>
        </View>
      )
    ) : icon ? (
      <View style={[styles.tile, styles.center]}>
        <GIcon name={icon} size={22} color={theme.color.accentLine} />
      </View>
    ) : null;
  const content = (
    <View style={styles.row}>
      {tile}
      <View style={[styles.rowBody, first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.line }]}>
        <View style={styles.rowWords}>
          <InkText size="md" weight="medium" tone={muted ? 'tertiary' : 'default'} numberOfLines={1}>
            {label}
          </InkText>
          {detail ? (
            <InkText size="sm" tone="secondary" numberOfLines={1}>
              {detail}
            </InkText>
          ) : null}
        </View>
        {value ? (
          <InkText size="md" tone="secondary">
            {value}
          </InkText>
        ) : null}
        {trailing ?? (onPress ? <GIcon name="chevron-right" size={18} color={theme.color.textTertiary} /> : null)}
      </View>
    </View>
  );
  if (!onPress || trailing) return content;
  return (
    <GPressable
      onPress={() => {
        void selectionTick();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
    >
      {content}
    </GPressable>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
  group: { paddingVertical: 0, paddingHorizontal: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingLeft: Spacing.md },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 52, paddingVertical: Spacing.sm, paddingRight: Spacing.md },
  rowWords: { flex: 1, gap: 1 },
  tile: { width: TILE, height: TILE },
  center: { alignItems: 'center', justifyContent: 'center' },
});
