/**
 * The sentence My Goose opens with, each clause run over with a highlighter: an accent band behind
 * its words, squared where the clause carries on and rounded where it starts and ends. Every
 * clause opens what it is about. The first, the one that needs the member most, is set in full
 * ink; the rest step back a shade, so the order reads without a label.
 *
 * Nested text cannot round its background, so each word is its own text in a wrapping row, and a
 * word carries the space after it inside the band, so a clause's bands join into one stroke.
 */

import React from 'react';
import { StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native';
import { inkText, useInkTheme } from '@jarida/ink/native';

import { GPressable } from '@/components/ui/g-pressable';

export interface SaidClause {
  text: string;
  onPress: () => void;
}

const BAND_RADIUS = 4;

export function HubSentence({ clauses, quiet }: { clauses: SaidClause[]; quiet: string }) {
  const theme = useInkTheme();
  const said = inkText(theme, { role: 'display', size: '2xl', weight: 600, tracking: 'tight', color: theme.color.text }).style;
  if (clauses.length === 0) {
    return (
      <Text style={[said, styles.line]} accessibilityRole="header">
        {quiet}
      </Text>
    );
  }

  const whole = clauses.map((c) => c.text).join(' ');
  const onAction = (e: AccessibilityActionEvent) => {
    const index = Number(e.nativeEvent.actionName.replace('open-', ''));
    clauses[index]?.onPress();
  };

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="text"
      accessibilityLabel={whole}
      accessibilityActions={clauses.map((c, i) => ({ name: `open-${i}`, label: c.text }))}
      onAccessibilityAction={onAction}
    >
      {clauses.map((clause, ci) => {
        const words = clause.text.split(/\s+/).filter(Boolean);
        const ink = ci === 0 ? theme.color.text : theme.color.textSecondary;
        return words.map((word, wi) => {
          const first = wi === 0;
          const last = wi === words.length - 1;
          return (
            <GPressable key={`${ci}-${wi}`} onPress={clause.onPress} accessible={false} hitSlop={2}>
              <Text
                style={[
                  said,
                  styles.line,
                  styles.band,
                  {
                    color: ink,
                    backgroundColor: theme.color.accentSoft,
                    borderTopLeftRadius: first ? BAND_RADIUS : 0,
                    borderBottomLeftRadius: first ? BAND_RADIUS : 0,
                    borderTopRightRadius: last ? BAND_RADIUS : 0,
                    borderBottomRightRadius: last ? BAND_RADIUS : 0,
                    paddingLeft: first ? 3 : 0,
                    paddingRight: last ? 3 : 0,
                    marginRight: last ? 6 : 0,
                  },
                ]}
              >
                {last ? word : `${word} `}
              </Text>
            </GPressable>
          );
        });
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4 },
  line: { fontSize: 26, lineHeight: 33 },
  band: { overflow: 'hidden' },
});
