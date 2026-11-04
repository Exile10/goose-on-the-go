/**
 * WidgetBoard — Home's widgets in two staggered columns, rearranged by dragging.
 *
 * The board draws each widget's frame behind it, sized to the widget's place, and the widget draws
 * only its content, which is what gets measured. That split is what lets a widget grow to close its
 * column without the growth feeding back into its own measurement.
 *
 * Rearranging folds every widget to one line, so the whole board fits on a screen and any widget
 * can be carried anywhere without the page having to scroll under the finger.
 *
 * Where a widget rests, and whether it is drawn at all, is React's style, never an animated value.
 * Reanimated 4.5 hands a settled animated value back to React only if its JS-thread poll lands in a
 * one-second window, and drops the value from its registry either way; once dropped unsynced, React's
 * next commit of that view restores the style it first rendered with. Places used to be animated
 * values that began hidden and zero-high, so a stalled JS thread blanked the board. Moving between
 * places is now a layout transition, and the only animated values left are the carry's offset and
 * lift, which rest at the values they start from.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type AccessibilityActionEvent, type ViewStyle } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { InkEdge, inkText, useInkTheme } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import type { IconName } from '@/constants/icons';
import { selectionTick, tap } from '@/services/haptics';
import { stagger, tileAt, type Rect, type Span } from './widget-layout';

/** `raised` is spent on what waits for an answer, `accent` on the one widget allowed to be loud. */
export type WidgetFrame = 'plain' | 'raised' | 'accent';

export interface BoardWidget {
  key: string;
  span: Span;
  frame: WidgetFrame;
  /** Said on the folded widget, and to a screen reader moving it. */
  title: string;
  icon: IconName;
  node: React.ReactNode;
}

export interface WidgetBoardProps {
  /** The widgets with something to say, in order. */
  widgets: BoardWidget[];
  editing: boolean;
  /** A long press on any widget asks for this. */
  onEdit: () => void;
  onMove: (key: string, target: string) => void;
  onStep: (key: string, delta: -1 | 1) => void;
}

/** Between frames, before the plate's own offset, which makes the visible gap 12. */
const GAP = 8;
/** A folded widget: one line, tall enough to hold with a thumb. */
const FOLDED = 52;
const SETTLE = { duration: 220, easing: Easing.out(Easing.cubic) };
const GLIDE = LinearTransition.duration(SETTLE.duration).easing(SETTLE.easing);

/** The widget in hand, and the place it was lifted from, where it stays drawn until it is let go. */
interface Carried {
  key: string;
  from: Rect;
}

export function WidgetBoard({ widgets, editing, onEdit, onMove, onStep }: WidgetBoardProps) {
  const theme = useInkTheme();
  const plate = theme.edge.rest;
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [carried, setCarried] = useState<Carried | null>(null);
  // Bumped for a widget that a focus pass finds placed but not drawn, which mounts it afresh.
  const [revived, setRevived] = useState<Record<string, number>>({});

  const measure = useCallback((key: string, height: number) => {
    setHeights((known) => (Math.abs((known[key] ?? -1) - height) < 0.5 ? known : { ...known, [key]: height }));
  }, []);

  // The height each frame was laid out at: what the screen shows, whatever React meant.
  const drawn = useRef<Record<string, number>>({});
  const frame = useCallback((key: string, height: number) => {
    drawn.current[key] = height;
  }, []);

  // Placed only once measured: a widget drawn before its height is known would land on another.
  const board = useMemo(() => {
    if (width === 0) return null;
    const tiles = widgets.filter((w) => heights[w.key] !== undefined).map(({ key, span }) => ({ key, span }));
    return stagger(tiles, (key) => (editing ? FOLDED : heights[key] + plate), width, GAP);
  }, [widgets, heights, width, editing, plate]);

  const rects = useRef<Record<string, Rect>>({});
  useEffect(() => {
    rects.current = board?.rects ?? {};
  }, [board]);

  useFocusEffect(
    useCallback(() => {
      const hidden = Object.keys(rects.current).filter((key) => !((drawn.current[key] ?? 0) >= 1));
      if (hidden.length === 0) return;
      for (const key of hidden) {
        console.warn('[home] a placed widget is not drawn; mounting it again', {
          kind: 'home_widget_hidden',
          key,
          height: rects.current[key].height,
          drawn: drawn.current[key] ?? null,
        });
      }
      setRevived((known) => ({ ...known, ...Object.fromEntries(hidden.map((key) => [key, (known[key] ?? 0) + 1])) }));
    }, []),
  );

  // The last widget swapped with, so hovering over it does not swap back and forth every frame.
  const passed = useRef<string | null>(null);
  // The same as `carried`, for the drag's callbacks, which must not wait for a render to see it.
  const holding = useRef<Carried | null>(null);
  const lift = useCallback((key: string) => {
    const from = rects.current[key];
    if (!from) return;
    passed.current = null;
    holding.current = { key, from };
    setCarried(holding.current);
    void tap();
  }, []);
  const carry = useCallback(
    (key: string, dx: number, dy: number) => {
      const from = holding.current?.key === key ? holding.current.from : null;
      if (!from) return;
      const target = tileAt(rects.current, from.x + dx + from.width / 2, from.y + dy + from.height / 2, key);
      if (target === null) passed.current = null;
      else if (target !== passed.current) {
        passed.current = target;
        void selectionTick();
        onMove(key, target);
      }
    },
    [onMove],
  );
  const drop = useCallback(() => {
    holding.current = null;
    setCarried(null);
  }, []);

  const shown = widgets.map((w) => w.key);
  const column = (width - GAP) / 2;

  return (
    <GestureHandlerRootView>
      <View
        style={{ height: board?.height ?? 0 }}
        onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      >
        {width > 0
          ? widgets.map((widget) => (
              <Cell
                key={`${widget.key}:${revived[widget.key] ?? 0}`}
                widget={widget}
                rect={board?.rects[widget.key] ?? null}
                held={carried?.key === widget.key ? carried.from : null}
                pendingWidth={widget.span === 2 ? width : column}
                editing={editing}
                onMeasure={measure}
                onFrame={frame}
                onEdit={onEdit}
                onLift={lift}
                onCarry={carry}
                onDrop={drop}
                onStep={onStep}
                canStep={{ earlier: shown.indexOf(widget.key) > 0, later: shown.indexOf(widget.key) < shown.length - 1 }}
              />
            ))
          : null}
      </View>
    </GestureHandlerRootView>
  );
}

interface CellProps {
  widget: BoardWidget;
  rect: Rect | null;
  /** Where the widget was lifted from, while it is in hand. */
  held: Rect | null;
  pendingWidth: number;
  editing: boolean;
  onMeasure: (key: string, height: number) => void;
  onFrame: (key: string, height: number) => void;
  onEdit: () => void;
  onLift: (key: string) => void;
  onCarry: (key: string, dx: number, dy: number) => void;
  onDrop: () => void;
  onStep: (key: string, delta: -1 | 1) => void;
  canStep: { earlier: boolean; later: boolean };
}

function Cell({ widget, rect, held, pendingWidth, editing, onMeasure, onFrame, onEdit, onLift, onCarry, onDrop, onStep, canStep }: CellProps) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const plate = theme.edge.rest;
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const lifted = held !== null;

  // The first place is taken at once and only moves after it glide, or a widget would fly in from the corner.
  const [settled, setSettled] = useState(rect !== null);

  // Worklets copy what they close over, and a widget carries its React content; they get the key alone.
  const key = widget.key;
  const carrying = useSharedValue(false);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);

  // Let go, the offset from the finger runs out while the frame glides from where it was lifted to its place.
  useEffect(() => {
    if (lifted) return;
    dx.set(withTiming(0, SETTLE));
    dy.set(withTiming(0, SETTLE));
  }, [lifted, dx, dy]);

  const at = held ?? rect;
  const place: ViewStyle = at
    ? { left: at.x, top: at.y, width: at.width, height: at.height, zIndex: lifted ? 10 : 0 }
    : { left: 0, top: 0, width: pendingWidth, height: 0, opacity: 0 };

  const motion = useAnimatedStyle(() => ({
    transform: [
      { translateX: dx.get() },
      { translateY: dy.get() },
      { scale: withTiming(carrying.get() ? 1.03 : 1, { duration: 120 }) },
    ],
  }));

  const move = Gesture.Pan()
    .enabled(editing)
    .minDistance(2)
    .onStart(() => {
      dx.set(0);
      dy.set(0);
      carrying.set(true);
      scheduleOnRN(onLift, key);
    })
    .onUpdate((e) => {
      dx.set(e.translationX);
      dy.set(e.translationY);
      scheduleOnRN(onCarry, key, e.translationX, e.translationY);
    })
    .onFinalize(() => {
      if (!carrying.get()) return;
      carrying.set(false);
      scheduleOnRN(onDrop);
    });
  const hold = Gesture.LongPress()
    .enabled(!editing)
    .minDuration(450)
    .onStart(() => {
      scheduleOnRN(onEdit);
    });

  const face = [
    { flex: 1 },
    widget.frame === 'plain' && !lifted ? { borderColor: theme.color.lineStrong } : null,
    widget.frame === 'accent' ? { backgroundColor: theme.color.accent, borderColor: theme.color.accent } : null,
  ];
  const onAccent = widget.frame === 'accent';

  const actions = [
    ...(canStep.earlier ? [{ name: 'earlier', label: t('home.board.moveEarlier') }] : []),
    ...(canStep.later ? [{ name: 'later', label: t('home.board.moveLater') }] : []),
  ];

  return (
    <GestureDetector gesture={Gesture.Race(move, hold)}>
      <Animated.View
        style={[styles.cell, place, motion]}
        layout={settled ? GLIDE : undefined}
        onLayout={(e) => {
          const { height } = e.nativeEvent.layout;
          if (height >= 1) setSettled(true);
          onFrame(widget.key, height);
        }}
        accessible={editing}
        accessibilityLabel={editing ? widget.title : undefined}
        accessibilityHint={editing ? t('home.board.moveHint') : undefined}
        accessibilityActions={editing ? actions : undefined}
        onAccessibilityAction={(e: AccessibilityActionEvent) => onStep(widget.key, e.nativeEvent.actionName === 'earlier' ? -1 : 1)}
      >
        <InkEdge
          raised={widget.frame === 'raised' || lifted}
          radius={theme.radius.xl}
          style={StyleSheet.absoluteFill}
          contentStyle={face}
          budgeted={!lifted}
        />
        <View
          // Measured at the width it will be placed at, not at whatever width the frame is passing through.
          style={[styles.content, { width: (rect?.width ?? pendingWidth) - plate }, editing && styles.hidden]}
          pointerEvents={editing ? 'none' : 'auto'}
          importantForAccessibility={editing ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={editing}
          onLayout={(e) => onMeasure(widget.key, e.nativeEvent.layout.height)}
        >
          {widget.node}
        </View>
        {editing ? (
          <View style={[styles.folded, { right: plate, bottom: plate }]} pointerEvents="none">
            <GIcon name={widget.icon} size={16} color={onAccent ? theme.color.textOnAccent : theme.color.accentLine} />
            <Text
              style={[styles.foldedTitle, onAccent && { color: theme.color.textOnAccent }]}
              numberOfLines={1}
            >
              {widget.title}
            </Text>
            <GIcon name="grip" size={16} color={onAccent ? theme.color.textOnAccent : theme.color.textTertiary} />
          </View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

const makeStyles = (theme: ReturnType<typeof useInkTheme>) =>
  StyleSheet.create({
    cell: { position: 'absolute', overflow: 'hidden' },
    content: { position: 'absolute', top: 0, left: 0, padding: theme.space[4] },
    hidden: { opacity: 0 },
    folded: {
      position: 'absolute',
      top: 0,
      left: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space[2],
      paddingHorizontal: theme.space[4],
    },
    foldedTitle: { ...inkText(theme, { size: 'base', weight: theme.weight.semibold }).style, flex: 1 },
  });
