/**
 * What a watched link shows: its price set large, how it moved since the check before, and its
 * history as a small line. A drop is good news and wears the success tone; a rise is said plainly.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { InkText, useInkTheme } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { atLowest, atTarget, priceMove, sparkline, sparklinePath, type CartItem } from '@/models/cart';
import { formatMoney } from '@/models/me-read';

/** "Down KSh 40,000", "Up KSh 35,000", "At your price", or null when nothing moved. */
export function usePriceWords(): (item: CartItem) => { text: string; tone: 'good' | 'warn' | null } | null {
  const { t } = useTranslation();
  return (item) => {
    if (item.status === 'failing') return { text: t('goose.cart.failing'), tone: 'warn' };
    if (item.status === 'checking' && !item.price) return { text: t('goose.cart.checking'), tone: null };
    if (atTarget(item)) return { text: t('goose.cart.atTarget'), tone: 'good' };
    const move = priceMove(item);
    if (move) return { text: t(move.direction === 'down' ? 'goose.cart.down' : 'goose.cart.up', { by: formatMoney(move.by) }), tone: move.direction === 'down' ? 'good' : null };
    if (atLowest(item)) return { text: t('goose.cart.lowest'), tone: 'good' };
    return null;
  };
}

export function PriceMove({ item }: { item: CartItem }) {
  const theme = useInkTheme();
  const words = usePriceWords()(item);
  if (!words) return null;
  const move = priceMove(item);
  const color = words.tone === 'good' ? theme.color.successFg : words.tone === 'warn' ? theme.color.warningFg : theme.color.textSecondary;
  const icon = item.status === 'failing' ? 'warn' : move?.direction === 'down' ? 'trending-down' : move?.direction === 'up' ? 'trending-up' : 'target';
  return (
    <View style={styles.move}>
      <GIcon name={icon} size={14} color={color} />
      <InkText size="sm" weight="semibold" style={{ color }}>
        {words.text}
      </InkText>
    </View>
  );
}

/** The price history as a line, with the latest price as a dot. Nothing for fewer than two checks. */
export function Sparkline({ item, width = 96, height = 30 }: { item: CartItem; width?: number; height?: number }) {
  const theme = useInkTheme();
  const points = sparkline(item.history, width, height, 3);
  if (points.length === 0) return null;
  const d = sparklinePath(points);
  const last = points[points.length - 1];
  const down = priceMove(item)?.direction === 'down';
  const stroke = down ? theme.color.successFg : theme.color.accentLine;
  return (
    <Svg width={width} height={height} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={d} stroke={stroke} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={last.x} cy={last.y} r={3} fill={stroke} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  move: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
