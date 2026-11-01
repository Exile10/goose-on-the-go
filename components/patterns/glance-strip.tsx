/**
 * GlanceStrip — what is true about the house right now, as one quiet line.
 *
 * This was three numbers in three tinted boxes, which is the default treatment for any set of
 * facts and made them the loudest thing under the greeting. They are not the loudest thing: the
 * sentence above them is. So they read as a line of plain phrases, and the space between them
 * does the separating -- no rules, no dots, no boxes.
 *
 * A phrase with no answer behind it is left out rather than shown as a dash, and the line is not
 * drawn at all when the Pond has answered none of it. The phrases wrap on a narrow screen and at
 * a large text size, which is the other reason they are not columns.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { InkText, useInkTheme } from '@jarida/ink/native';

/** One fact, already written as a phrase: "4 devices on", "21° in Nairobi". */
export interface Figure {
  key: string;
  phrase: string;
}

export function GlanceStrip({ figures }: { figures: Figure[] }) {
  const theme = useInkTheme();
  const styles = makeStyles(theme);

  if (figures.length === 0) return null;

  return (
    <View style={styles.line}>
      {figures.map((figure) => (
        <InkText key={figure.key} size="sm" tone="secondary">
          {figure.phrase}
        </InkText>
      ))}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useInkTheme>) =>
  StyleSheet.create({
    // The gap is the separator. Wide enough to read as a break, short enough to stay one line.
    line: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: theme.space[4],
      rowGap: theme.space[1],
      marginBottom: theme.space[5],
    },
  });
