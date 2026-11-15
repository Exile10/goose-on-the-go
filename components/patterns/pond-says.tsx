/**
 * PondSays — the one thing Home states, in the Pond's own voice.
 *
 * Home used to open on a greeting and three counters, which is what any screen with a user and
 * some numbers opens on. The characteristic thing about this product is not that it knows your
 * name: it is that something of yours has been thinking about your house while you were out. So
 * that is what the top of the screen says, and it says it as a sentence rather than as a card
 * with a label.
 *
 * Set in the display italic, which is the most recognisable thing in this typography and was
 * being spent on the user's first name.
 *
 * A proposal is not said here: it is the From your Pond widget's, with its reason and a yes or no,
 * and Home draws this line only while nothing is proposed. Then it says, in order of what is true:
 *
 * 1. Reminders waiting, leading to where they are dismissed.
 * 2. That nothing needs you -- which is worth saying plainly rather than leaving a gap, but only
 *    once the reads have answered: a read that failed is unknown, and then it says nothing.
 *
 * Draws nothing while the Pond cannot be reached: the card below is already saying so, and a
 * sentence about an unreachable Pond would be a second voice saying the same thing.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkTitle, useInkTheme } from '@/components/ui/ink';

import { GPressable } from '@/components/ui/g-pressable';
import { selectionTick } from '@/services/haptics';

export interface PondSaysProps {
  reminderCount: number;
  /** Both reads answered with nothing. */
  quiet: boolean;
}

export function PondSays({ reminderCount, quiet }: PondSaysProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useInkTheme();
  const styles = makeStyles(theme);

  // `InkTitle`, not a hand-set style: Quicksand ships no italic face, so each platform fakes it
  // differently and `core/font.ts` is what knows how. Setting the spec by hand rendered the
  // sentence upright on the phone while every card title beside it slanted -- which lost the
  // whole point of putting it here.

  if (reminderCount > 0) {
    return (
      <GPressable
        style={styles.block}
        accessibilityRole="button"
        onPress={() => {
          void selectionTick();
          router.push('/(stack)/reminders');
        }}
      >
        <InkTitle level={1}>{t('home.saysReminders', { count: reminderCount })}</InkTitle>
      </GPressable>
    );
  }

  if (!quiet) return null;

  return (
    <View style={styles.block}>
      <InkTitle level={1}>{t('home.saysQuiet')}</InkTitle>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useInkTheme>) =>
  StyleSheet.create({
    block: { gap: theme.space[2], marginBottom: theme.space[5] },
  });
