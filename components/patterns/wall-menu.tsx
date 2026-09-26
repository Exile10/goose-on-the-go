/**
 * WallMenu — how the wall is laid out, what it shows, and the way into
 * choosing several, from the puck in its corner.
 *
 * Three things, top to bottom in the order they are reached for: the layout,
 * the filter, then Select, which is an action rather than a setting and so
 * sits apart below a hairline. A layout or a filter applies the moment it is
 * chosen and puts the menu away; there is nothing to confirm.
 *
 * The filter is the one distinction the Pond itself draws between
 * conversations: a person started it, or the Pond did, for a schedule or a
 * rule (`isRoutine`). Those runs share the list with everything else, and a
 * Pond with a morning briefing adds one a day, so hiding them is the filter
 * worth having. There is nothing else in the data to filter on, and inventing
 * a facet would be inventing a structure the conversations do not have.
 *
 * The panel grows out of the puck that opened it — scaled from that corner,
 * not from its own centre — and returns the same way, so where it came from is
 * never in doubt. No scrim: it is a quick choice made over the wall, and the
 * wall changing underneath is the confirmation.
 */

import React, { useEffect, useState } from 'react';
import { Animated, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { glassLift } from '@jarida/ink';
import {
  InkSegmented,
  InkText,
  InkTitle,
  inkText,
  useInkTheme,
  useReduceMotion,
  type InkSegmentedOption,
} from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { selectionTick, tap } from '@/services/haptics';
import type { HistoryFilter, HistoryView } from '@/view-models/use-chat-history';

/** Response 0.3s, critically damped. A menu arriving did not carry momentum. */
const SPRING = { stiffness: 420, damping: 41, mass: 1 } as const;

const PANEL_WIDTH = 296;

export interface WallMenuProps {
  open: boolean;
  onClose: () => void;
  view: HistoryView;
  onViewChange: (view: HistoryView) => void;
  filter: HistoryFilter;
  onFilterChange: (filter: HistoryFilter) => void;
  /** False while there is nothing on the wall to choose from. */
  canSelect: boolean;
  onSelect: () => void;
  /** Where the puck's lower edge is, so the panel hangs from it. */
  top: number;
  right: number;
}

export function WallMenu({
  open,
  onClose,
  view,
  onViewChange,
  filter,
  onFilterChange,
  canSelect,
  onSelect,
  top,
  right,
}: WallMenuProps) {
  const theme = useInkTheme();
  const reduced = useReduceMotion();
  const { t } = useTranslation();

  // Mounted through its exit, so closing is the opening played backwards
  // rather than a disappearance. Reduced motion has no exit to play, so there
  // the panel is simply there or not.
  const [exiting, setExiting] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const [progress] = useState(() => new Animated.Value(0));

  // Derived during render rather than in the effect: the exit has to begin on
  // the pass that closes the panel, or its first frame is spent unmounted.
  if (open !== wasOpen) {
    setWasOpen(open);
    setExiting(!open && !reduced);
  }

  useEffect(() => {
    const to = open ? 1 : 0;
    if (reduced) {
      progress.setValue(to);
      return;
    }
    Animated.spring(progress, { toValue: to, ...SPRING, useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished && !open) setExiting(false);
      },
    );
  }, [open, reduced, progress]);

  const mounted = open || exiting;

  // Android's back button closes the panel before it leaves the screen.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  if (!mounted) return null;

  const views: InkSegmentedOption<HistoryView>[] = [
    { value: 'grid', label: t('chat.history.viewGrid') },
    { value: 'list', label: t('chat.history.viewList') },
  ];

  const options: InkSegmentedOption<HistoryFilter>[] = [
    { value: 'all', label: t('chat.history.filterAll') },
    { value: 'chats', label: t('chat.history.filterChats') },
    { value: 'routines', label: t('chat.history.filterRoutines') },
  ];

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const action = inkText(theme, { size: 'md', weight: theme.weight.medium });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'box-none' : 'none'}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessible={false}
        importantForAccessibility="no"
      />
      <Animated.View
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        style={[
          styles.panel,
          {
            top,
            right,
            gap: theme.space[4],
            paddingTop: theme.space[4],
            paddingHorizontal: theme.space[4],
            // The last row is a 44pt target with its own air around the word.
            paddingBottom: theme.space[2],
            borderRadius: theme.radius.xl,
            backgroundColor: theme.color.chrome,
            borderColor: theme.color.lineStrong,
            borderWidth: theme.edge.hairlineWidth,
            opacity: progress,
            transform: [{ scale }],
          },
          glassLift(theme),
        ]}
      >
        <View style={{ gap: theme.space[3] }}>
          <InkTitle level={3}>{t('chat.history.viewTitle')}</InkTitle>
          <InkSegmented
            label={t('chat.history.viewTitle')}
            value={view}
            options={views}
            onChange={(next) => {
              void selectionTick();
              onViewChange(next);
              onClose();
            }}
          />
        </View>
        <View style={{ gap: theme.space[3] }}>
          <InkTitle level={3}>{t('chat.history.filterTitle')}</InkTitle>
          <InkSegmented
            label={t('chat.history.filterTitle')}
            value={filter}
            options={options}
            onChange={(next) => {
              void selectionTick();
              onFilterChange(next);
              onClose();
            }}
          />
          <InkText size="sm" tone="tertiary">
            {t('chat.history.filterRoutinesBody')}
          </InkText>
        </View>
        <View>
          {/* Across the whole panel, as a menu divides an action from its settings. */}
          <View
            style={{
              height: theme.edge.hairlineWidth,
              marginHorizontal: -theme.space[4],
              backgroundColor: theme.color.line,
            }}
          />
          <GPressable
            feedback="tint"
            disabled={!canSelect}
            onPress={() => {
              void tap();
              onClose();
              onSelect();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('chat.history.select')}
            accessibilityState={{ disabled: !canSelect }}
            style={[
              styles.action,
              {
                gap: theme.space[3],
                minHeight: theme.touch.tapMin,
                marginTop: theme.space[2],
                // The wash reaches past the text towards the panel's edge,
                // while the glyph stays on the headings' line.
                marginHorizontal: -theme.space[3],
                paddingHorizontal: theme.space[3],
                borderRadius: theme.radius.md,
              },
              canSelect ? null : styles.off,
            ]}
          >
            <GIcon name="select" size={20} color={theme.color.text} />
            <Text style={action.style}>{t('chat.history.select')}</Text>
          </GPressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    width: PANEL_WIDTH,
    maxWidth: '92%',
    // The corner it grows from is the puck's.
    transformOrigin: 'top right',
  },
  action: { flexDirection: 'row', alignItems: 'center' },
  // Ink's own menu dims an unavailable item this far.
  off: { opacity: 0.45 },
});
