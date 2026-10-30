/**
 * LiveLogLines — the Pond's log as a developer reads it: one line per row, newest first, in a
 * monospace face, the level coloured when it is a warning or an error.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Semantic, type ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { FontFamily, FontSize } from '@/constants/typography';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { logTimeOfDay } from '@/models/log';
import type { LogEntry } from '@/services/types';

/** A warning's or an error's colour; other levels keep the line's own. */
function levelStyle(level: string) {
  switch (level.toUpperCase()) {
    case 'ERROR':
      return { color: Semantic.danger };
    case 'WARN':
      return { color: Semantic.warning };
    default:
      return null;
  }
}

export function LiveLogLines({ entries }: { entries: LogEntry[] }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.lines}>
      {entries.map((e) => (
        <Text key={e.id} style={styles.line} selectable>
          <Text style={styles.meta}>{logTimeOfDay(e.timestamp)} </Text>
          <Text style={[styles.meta, levelStyle(e.level)]}>{e.level.toUpperCase().padEnd(5)} </Text>
          <Text style={styles.meta}>{e.source} </Text>
          {e.message}
        </Text>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    lines: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, gap: Spacing.xs },
    line: { fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: c.text, lineHeight: FontSize.xs * 1.5 },
    meta: { color: c.textTertiary },
  });
