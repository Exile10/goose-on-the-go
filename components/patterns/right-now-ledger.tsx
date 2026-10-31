/**
 * RightNowLedger — Home's facts about the house, one hairline surface, one line each.
 *
 * A fixed label column lets the eye run down the values without reading the labels twice, and
 * the surface is a hairline rather than a raised card: the raised edge is spent on the decisions
 * above it. Lines that lead somewhere carry a chevron and take the whole row as the target.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkEdge, inkText, useInkTheme } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { EqualizerBars } from '@/components/ui/equalizer-bars';
import type { TranslationKey } from '@/services/i18n';
import type { LedgerEntry, LedgerKind } from '@/view-models/home-ledger';

const LABELS: Record<LedgerKind, TranslationKey> = {
  playing: 'home.ledger.playingLabel',
  next: 'home.ledger.nextLabel',
  devices: 'home.ledger.devicesLabel',
  outside: 'home.ledger.outsideLabel',
  remember: 'home.ledger.rememberLabel',
};

export interface RightNowLedgerProps {
  entries: LedgerEntry[];
  /** Where a line leads, by kind. A kind with no entry here is a fact, not a link. */
  onOpen: Partial<Record<LedgerKind, () => void>>;
}

export function RightNowLedger({ entries, onOpen }: RightNowLedgerProps) {
  const theme = useInkTheme();
  const styles = makeStyles(theme);
  const { t } = useTranslation();

  if (entries.length === 0) return null;

  return (
    <InkEdge raised={false} radius={theme.radius.lg} contentStyle={styles.surface}>
      {entries.map((entry, i) => {
        const open = onOpen[entry.kind];
        const line = (
          <View style={[styles.line, i > 0 && styles.divided]}>
            <Text style={styles.label} numberOfLines={1}>
              {t(LABELS[entry.kind])}
            </Text>
            <Text style={styles.value} numberOfLines={1}>
              {entry.value}
            </Text>
            {entry.detail ? <Text style={styles.detail}>{entry.detail}</Text> : null}
            {/* Bars only while something plays: the line is not drawn over silence. */}
            {entry.kind === 'playing' ? <EqualizerBars color={theme.color.accentLine} count={4} height={12} /> : null}
            {open ? <GIcon name="chevron-right" size={16} color={theme.color.textTertiary} strokeWidth={2.5} /> : null}
          </View>
        );
        return open ? (
          <GPressable
            key={entry.kind}
            onPress={open}
            accessibilityRole="button"
            accessibilityLabel={[t(LABELS[entry.kind]), entry.value, entry.detail].filter(Boolean).join(', ')}
          >
            {line}
          </GPressable>
        ) : (
          <View key={entry.kind} accessible accessibilityLabel={[t(LABELS[entry.kind]), entry.value, entry.detail].filter(Boolean).join(', ')}>
            {line}
          </View>
        );
      })}
    </InkEdge>
  );
}

const makeStyles = (theme: ReturnType<typeof useInkTheme>) =>
  StyleSheet.create({
    surface: { paddingHorizontal: theme.space[4] },
    line: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space[3],
      minHeight: theme.rowHeight.md,
      paddingVertical: theme.space[2],
    },
    divided: { borderTopWidth: theme.edge.hairlineWidth, borderTopColor: theme.color.line },
    // A column, so the values start on one vertical; a minimum, so a large text size widens it
    // rather than cutting "Remember" short.
    label: { ...inkText(theme, { size: 'sm', color: theme.color.textTertiary }).style, minWidth: 72 },
    value: { ...inkText(theme, { size: 'base', weight: theme.weight.medium }).style, flex: 1 },
    detail: {
      ...inkText(theme, { size: 'sm', color: theme.color.textSecondary }).style,
      fontVariant: ['tabular-nums'],
    },
  });
