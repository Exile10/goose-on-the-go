/**
 * WallSelectionBar — what to do with the conversations chosen, where the dock was.
 *
 * It takes the dock's place and the dock's shape: the same strip above the
 * bottom bar, in the same chrome material, so choosing several reads as the
 * wall's own controls changing rather than as a new layer arriving. Search and
 * compose have nothing to offer while choosing, so they are gone rather than
 * dimmed.
 *
 * Select all on the left, the count in the middle, and Delete on the right in
 * the danger ink, unavailable while nothing is chosen. Delete asks before it
 * acts, in the bar itself — Delete or Keep, no dialog — as a card asks on
 * itself. Keep lands where Delete was, so a second tap that arrives late keeps
 * rather than deletes.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { glassLift } from '@jarida/ink';
import { inkText, useInkTheme } from '@/components/ui/ink';

import { DeleteOrKeep } from '@/components/patterns/conversation-card';
import { PUCK_SIZE } from '@/components/patterns/chrome-puck';
import { WALL_GUTTER } from '@/components/patterns/conversation-wall';
import { DOCK_GAP } from '@/components/patterns/wall-dock';
import { GPressable } from '@/components/ui/g-pressable';

export interface WallSelectionBarProps {
  /** How many of the conversations on the wall are chosen. */
  count: number;
  /** How many could be. Select all has nothing to do while this is zero. */
  available: number;
  /** Asking whether to delete them, in place of the three controls. */
  confirming: boolean;
  onToggleAll: () => void;
  onAskDelete: () => void;
  onDelete: () => void;
  onKeep: () => void;
  /** The bar's strip, which this floats above exactly as the dock does. */
  bottomInset: number;
}

export function WallSelectionBar({
  count,
  available,
  confirming,
  onToggleAll,
  onAskDelete,
  onDelete,
  onKeep,
  bottomInset,
}: WallSelectionBarProps) {
  const theme = useInkTheme();
  const { t } = useTranslation();

  const everything = available > 0 && count === available;
  const action = inkText(theme, { size: 'base', weight: theme.weight.semibold });
  const status = inkText(theme, { size: 'base', color: theme.color.textSecondary });
  const question = inkText(theme, { size: 'base' });
  const danger = inkText(theme, {
    size: 'base',
    weight: theme.weight.semibold,
    color: theme.color.dangerFg,
  });
  const control = {
    minHeight: theme.touch.tapMin,
    paddingHorizontal: theme.space[3],
    borderRadius: theme.radius.pill,
  };

  return (
    <View
      accessibilityRole="toolbar"
      accessibilityLabel={t('chat.history.selection')}
      style={[
        styles.bar,
        {
          bottom: bottomInset + DOCK_GAP,
          paddingHorizontal: theme.space[2],
          backgroundColor: theme.color.chrome,
          borderColor: theme.color.lineStrong,
          borderWidth: theme.edge.hairlineWidth,
        },
        glassLift(theme),
      ]}
    >
      {confirming ? (
        <>
          <Text
            style={[question.style, styles.question, { paddingHorizontal: theme.space[3] }]}
            numberOfLines={1}
          >
            {t('chat.history.deleteMany', { count })}
          </Text>
          <DeleteOrKeep
            deleteLabel={t('chat.history.delete')}
            onDelete={onDelete}
            onKeep={onKeep}
            style={{ paddingRight: theme.space[2] }}
          />
        </>
      ) : (
        <>
          <View style={styles.side}>
            <GPressable
              feedback="tint"
              disabled={available === 0}
              onPress={onToggleAll}
              accessibilityRole="button"
              accessibilityState={{ disabled: available === 0 }}
              style={[styles.control, control, available === 0 ? styles.off : null]}
            >
              <Text style={action.style}>
                {t(everything ? 'chat.history.deselectAll' : 'chat.history.selectAll')}
              </Text>
            </GPressable>
          </View>
          <Text
            style={[status.style, styles.count]}
            numberOfLines={1}
            accessibilityLiveRegion="polite"
          >
            {t('chat.history.selected', { count })}
          </Text>
          <View style={[styles.side, styles.end]}>
            <GPressable
              feedback="tint"
              disabled={count === 0}
              onPress={onAskDelete}
              accessibilityRole="button"
              accessibilityState={{ disabled: count === 0 }}
              style={[styles.control, control, count === 0 ? styles.off : null]}
            >
              <Text style={danger.style}>{t('chat.history.delete')}</Text>
            </GPressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: WALL_GUTTER,
    right: WALL_GUTTER,
    height: PUCK_SIZE,
    borderRadius: PUCK_SIZE / 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Equal sides, so the count sits in the middle of the bar whatever either
  // label says.
  side: { flex: 1, flexDirection: 'row' },
  end: { justifyContent: 'flex-end' },
  control: { justifyContent: 'center' },
  count: { flexShrink: 0, textAlign: 'center' },
  question: { flex: 1 },
  // Ink's own menu dims an unavailable item this far.
  off: { opacity: 0.45 },
});
