/**
 * The pieces of an iPhone-style settings list: groups of rows on a recessed page, each row a
 * coloured icon, a label, what it is set to, and a chevron when it leads somewhere.
 */

import React, { Children, isValidElement, type ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { GIcon } from '@/components/ui/g-icon';
import { Brand, TileColors, type TileColor } from '@/constants/colors';
import type { IconName } from '@/constants/icons';
import { Radii } from '@/constants/radii';
import { Spacing } from '@/constants/spacing';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { useSettingsColors, useSettingsStyles, type SettingsColors } from './settings-theme';

const TILE = 30;
const ROW_PADDING = Spacing.lg;
/** Where a hairline starts in a group whose rows carry tiles: under the label, as on iOS. */
export const TILE_INSET = ROW_PADDING + TILE + Spacing.md;

export function IconTile({ icon, tile, size = TILE }: { icon: IconName; tile: TileColor; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.27),
        backgroundColor: TileColors[tile],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <GIcon name={icon} size={Math.round(size * 0.58)} color={Brand.white} strokeWidth={2} />
    </View>
  );
}

/**
 * A group of rows. Hairlines go between rows, not around the group, and start at `inset` so a
 * divider never cuts under an icon.
 */
export function SettingsGroup({
  title,
  footer,
  inset = ROW_PADDING,
  children,
  style,
}: {
  title?: string | null;
  footer?: ReactNode;
  inset?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useSettingsStyles(makeStyles);
  const rows = Children.toArray(children).filter((child) => isValidElement(child) || typeof child === 'string');
  if (rows.length === 0 && !footer) return null;

  return (
    <View style={[styles.groupWrap, style]}>
      {title ? (
        <Text style={styles.groupTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {rows.length > 0 ? (
        <View style={styles.group}>
          {rows.map((row, i) => (
            <View key={isValidElement(row) && row.key != null ? row.key : i}>
              {i > 0 ? <View style={[styles.separator, { marginLeft: inset }]} /> : null}
              {row}
            </View>
          ))}
        </View>
      ) : null}
      {footer ? (typeof footer === 'string' ? <Text style={styles.footer}>{footer}</Text> : footer) : null}
    </View>
  );
}

/** A hairline inside a row that draws two rows of its own, matching the group's own dividers. */
export function RowSeparator({ inset = ROW_PADDING }: { inset?: number }) {
  const styles = useSettingsStyles(makeStyles);
  return <View style={[styles.separator, { marginLeft: inset }]} />;
}

export interface SettingsRowProps {
  label: string;
  icon?: IconName;
  tile?: TileColor;
  /** A line under the label saying what the setting does. */
  description?: string | null;
  /** What the setting is set to, on the right. */
  value?: string | null;
  /** A control on the right in place of a value, such as a switch. */
  trailing?: ReactNode;
  /** `next` leads to another page; `menu` opens a list of choices. */
  accessory?: 'next' | 'menu' | 'none';
  /** Under the description: why a change will wait, or why the Pond refused one. */
  note?: string | null;
  error?: string | null;
  destructive?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  /** The row's control, read with it by a screen reader: `switch`, `button`, `radio`. */
  accessibilityRole?: 'button' | 'switch' | 'radio' | 'link' | 'adjustable';
  accessibilityState?: { checked?: boolean; selected?: boolean; disabled?: boolean; busy?: boolean };
  /** Content under the label, such as a text field, that belongs to this row. */
  children?: ReactNode;
}

export function SettingsRow({
  label,
  icon,
  tile = 'slate',
  description,
  value,
  trailing,
  accessory = 'none',
  note,
  error,
  destructive,
  disabled,
  onPress,
  accessibilityRole,
  accessibilityState,
  children,
}: SettingsRowProps) {
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  const body = (
    <View style={[styles.row, disabled && styles.disabled]}>
      {icon ? <IconTile icon={icon} tile={tile} /> : null}
      <View style={styles.main}>
        <View style={styles.line}>
          <View style={styles.labels}>
            <Text style={[styles.label, destructive && { color: colors.danger }]}>{label}</Text>
            {description ? <Text style={styles.description}>{description}</Text> : null}
          </View>
          {value ? (
            <Text style={styles.value} numberOfLines={1}>
              {value}
            </Text>
          ) : null}
          {trailing}
          {accessory === 'next' ? <GIcon name="chevron-right" size={18} color={colors.textTertiary} /> : null}
          {accessory === 'menu' ? <GIcon name="updown" size={16} color={colors.textTertiary} /> : null}
        </View>
        {children}
        {note ? <Text style={styles.note}>{note}</Text> : null}
        {error ? (
          <Text style={[styles.note, { color: colors.danger }]} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityState={{ disabled, ...accessibilityState }}
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityHint={description ?? undefined}
      // The press shows the instant a finger lands, not when it lifts.
      style={({ pressed }) => (pressed ? { backgroundColor: colors.pressed } : null)}
    >
      {body}
    </Pressable>
  );
}

/** The top of a detail page: the setting's icon, its name, and a line on what it covers. */
export function SettingsHeader({
  icon,
  tile,
  title,
  description,
}: {
  icon: IconName;
  tile: TileColor;
  title: string;
  description: string;
}) {
  const styles = useSettingsStyles(makeStyles);
  return (
    <View style={[styles.group, styles.header]}>
      <IconTile icon={icon} tile={tile} size={52} />
      <Text style={styles.headerTitle} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.headerBody}>{description}</Text>
    </View>
  );
}

/** A centred line on the page itself, for a state rather than a setting. */
export function SettingsMessage({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'danger' }) {
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  return (
    <Text style={[styles.message, tone === 'danger' && { color: colors.danger }]} accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}

const makeStyles = (c: SettingsColors) => ({
  groupWrap: { marginBottom: Spacing['2xl'] },
  groupTitle: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: c.textSecondary,
    marginLeft: ROW_PADDING,
    marginBottom: Spacing.sm,
  },
  group: {
    backgroundColor: c.group,
    borderRadius: Radii.xl,
    overflow: 'hidden' as const,
  },
  separator: { height: 1, backgroundColor: c.line },
  footer: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: c.textSecondary,
    lineHeight: FontSize.sm * 1.45,
    marginTop: Spacing.sm,
    marginHorizontal: ROW_PADDING,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: Spacing.md,
    minHeight: 52,
    paddingHorizontal: ROW_PADDING,
    paddingVertical: Spacing.md,
  },
  disabled: { opacity: 0.45 },
  main: { flex: 1, gap: Spacing.sm, justifyContent: 'center' as const, minHeight: TILE },
  line: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.sm, minHeight: TILE },
  labels: { flex: 1, gap: 2 },
  label: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: c.text,
  },
  description: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: c.textSecondary,
    lineHeight: FontSize.sm * 1.4,
  },
  value: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.md,
    color: c.textSecondary,
    maxWidth: '55%' as const,
    textAlign: 'right' as const,
  },
  note: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: c.textTertiary,
    lineHeight: FontSize.sm * 1.4,
  },
  header: {
    alignItems: 'flex-start' as const,
    gap: Spacing.sm,
    padding: Spacing.lg,
    marginBottom: Spacing['2xl'],
  },
  headerTitle: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize['2xl'],
    fontWeight: FontWeight.bold,
    letterSpacing: -0.3,
    color: c.text,
    marginTop: Spacing.xs,
  },
  headerBody: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.md,
    color: c.textSecondary,
    lineHeight: FontSize.md * 1.45,
  },
  message: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.md,
    color: c.textSecondary,
    textAlign: 'center' as const,
    marginVertical: Spacing.lg,
    marginHorizontal: Spacing.xl,
  },
});
