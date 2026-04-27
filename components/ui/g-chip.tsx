/**
 * GChip — Compact status badge / tag.
 *
 * @example
 *   <GChip variant="success" startIcon="check">Active</GChip>
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Grey, JaridaPurple, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Radii } from '@/constants/radii';
import { Spacing } from '@/constants/spacing';
import { GIcon } from './g-icon';
import type { IconName } from '@/constants/icons';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GChipVariant =
  | 'default'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'primary';

export type GChipSize = 'sm' | 'md';

export interface GChipProps {
  variant?: GChipVariant;
  size?: GChipSize;
  startIcon?: IconName;
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Variant style maps
// ---------------------------------------------------------------------------

interface ChipVariantStyle {
  bg: string;
  text: string;
}

const VARIANT_STYLES: Record<GChipVariant, ChipVariantStyle> = {
  default: { bg: Grey[100], text: Grey[700] },
  secondary: { bg: JaridaPurple[50], text: JaridaPurple[700] },
  success: { bg: Semantic.successSoft, text: Semantic.success },
  warning: { bg: Semantic.warningSoft, text: Semantic.warning },
  danger: { bg: Semantic.dangerSoft, text: Semantic.danger },
  primary: { bg: Semantic.infoSoft, text: Semantic.info },
};

interface ChipSizeStyle {
  height: number;
  paddingHorizontal: number;
  fontSize: number;
  iconSize: number;
}

const SIZE_STYLES: Record<GChipSize, ChipSizeStyle> = {
  sm: {
    height: 20,
    paddingHorizontal: Spacing.sm,
    fontSize: FontSize.xs,
    iconSize: 10,
  },
  md: {
    height: 24,
    paddingHorizontal: 10,
    fontSize: FontSize.sm,
    iconSize: 12,
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function GChipInner({
  variant = 'default',
  size = 'md',
  startIcon,
  children,
}: GChipProps) {
  const v = VARIANT_STYLES[variant];
  const s = SIZE_STYLES[size];

  return (
    <View
      style={[
        styles.container,
        {
          height: s.height,
          paddingHorizontal: s.paddingHorizontal,
          backgroundColor: v.bg,
        },
      ]}
    >
      {startIcon && (
        <GIcon
          name={startIcon}
          size={s.iconSize}
          color={v.text}
        />
      )}
      <Text
        style={[
          styles.label,
          {
            fontSize: s.fontSize,
            color: v.text,
            marginLeft: startIcon ? 4 : 0,
          },
        ]}
        numberOfLines={1}
      >
        {children}
      </Text>
    </View>
  );
}

export const GChip = React.memo(GChipInner);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: Radii.pill,
  },
  label: {
    fontFamily: FontFamily.body,
    fontWeight: FontWeight.semibold,
  },
});
