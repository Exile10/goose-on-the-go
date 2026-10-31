/**
 * GlanceStrip — the figures Home can state in one row, in place of the badge pair.
 *
 * A figure with no answer behind it is left out rather than drawn as a dash: the row says only
 * what the Pond actually reported, and hides entirely when it reported none of it. That is the
 * same rule the cards below it follow.
 *
 * The temperature names its place because the Pond's weather is wherever the Pond is configured
 * to be, which is not always where the reader is. There is no high and low: `GET /weather`
 * answers one temperature, and the forecast reaches the phone only as a chat tool result.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { InkText, inkText, useInkTheme } from '@jarida/ink/native';

export interface Figure {
  key: string;
  value: string;
  label: string;
}

export function GlanceStrip({ figures }: { figures: Figure[] }) {
  const theme = useInkTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // Tabular figures and the display face's negative tracking: a number is the loudest thing in
  // the row, and a proportional set shuffles the label under it each time the count changes.
  const value = useMemo(
    () => inkText(theme, { role: 'display', size: 'lg', weight: theme.weight.semibold, tracking: 'title' }).style,
    [theme],
  );

  if (figures.length === 0) return null;

  return (
    <View style={styles.strip}>
      {figures.map((figure) => (
        // One element per figure, labelled with both its lines: read apart, "4" and "on now" are
        // two announcements that say nothing on their own.
        <View
          key={figure.key}
          style={styles.figure}
          accessible
          accessibilityLabel={`${figure.value} ${figure.label}`}
        >
          <Text style={[value, styles.numeric]}>{figure.value}</Text>
          <InkText size="sm" tone="tertiary" numberOfLines={1}>{figure.label}</InkText>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useInkTheme>) =>
  StyleSheet.create({
    strip: { flexDirection: 'row', gap: theme.space[2] },
    // Equal widths, so three figures read as one row of three rather than as a ragged line.
    figure: {
      flex: 1,
      gap: theme.space[1],
      paddingVertical: theme.space[2],
      paddingHorizontal: theme.space[3],
      borderRadius: theme.radius.lg,
      backgroundColor: theme.color.content,
    },
    numeric: { fontVariant: ['tabular-nums'] },
  });
