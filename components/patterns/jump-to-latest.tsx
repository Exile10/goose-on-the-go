/**
 * JumpToLatest — the round arrow that takes a reader back to the newest message.
 *
 * It floats over the foot of the thread, centred, just above the composer, and
 * only while the reader is well back in the conversation (`latest-button.ts`
 * decides when). It is drawn from the same material as the composer's own round
 * controls — solid chrome, a strong hairline, the glass lift — because it is
 * the same kind of thing: a piece of chrome sitting on the page.
 *
 * The dot is the hint that the thread moved while the reader was away: a new
 * message, or a reply still being written. The label says the same thing in
 * words for anyone not looking at the dot.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { glassLift } from '@jarida/ink';
import { useInkTheme } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';

/** Smaller than the composer's 44pt controls, so it reads as secondary to them; `hitSlop` keeps the touch floor. */
const SIZE = 36;

export interface JumpToLatestProps {
  onPress: () => void;
  /** The thread moved at its foot since the reader left it. */
  unseen: boolean;
}

export function JumpToLatest({ onPress, unseen }: JumpToLatestProps) {
  const theme = useInkTheme();
  const { t } = useTranslation();

  return (
    <GPressable
      feedback="lift"
      onPress={onPress}
      hitSlop={(theme.touch.tapMin - SIZE) / 2}
      accessibilityRole="button"
      accessibilityLabel={unseen ? t('chat.toLatestUnseen') : t('chat.toLatest')}
      style={[
        styles.button,
        {
          backgroundColor: theme.color.chrome,
          borderColor: theme.color.lineStrong,
          borderWidth: theme.edge.hairlineWidth,
        },
        glassLift(theme),
      ]}
    >
      <GIcon name="arrow-down" size={18} color={theme.color.text} />
      {unseen ? (
        <View
          style={[styles.dot, { backgroundColor: theme.color.accent, borderColor: theme.color.chrome }]}
        />
      ) : null}
    </GPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
});
