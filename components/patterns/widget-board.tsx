/**
 * WidgetBoard — Home's widgets in two staggered columns, rearranged by dragging.
 *
 * The board draws each widget's frame behind it, sized to the widget's place, and the widget draws
 * only its content, which is what gets measured. That split is what lets a widget grow to close its
 * column without the growth feeding back into its own measurement.
 *
 * Rearranging folds every widget to one line, so the whole board fits on a screen and any widget
 * can be carried anywhere without the page having to scroll under the finger.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
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

export function WidgetBoard({ widgets, editing, onEdit, onMove, onStep }: WidgetBoardProps) {
  const theme = useInkTheme();
  const plate = theme.edge.rest;
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [carried, setCarried] = useState<string | null>(null);

  const measure = useCallback((key: string, height: number) => {
    setHeights((known) => (Math.abs((known[key] ?? -1) - height) < 0.5 ? known : { ...known, [key]: height }));
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

  // The last widget swapped with, so hovering over it does not swap back and forth every frame.
  const passed = useRef<string | null>(null);
  const lift = useCallback((key: string) => {
    passed.current = null;
    setCarried(key);
    void tap();
  }, []);
  const carry = useCallback(
    (key: string, x: number, y: number) => {
      const target = tileAt(rects.current, x, y, key);
      if (target === null) passed.current = null;
      else if (target !== passed.current) {
        passed.current = target;
        void selectionTick();
        onMove(key, target);
      }
    },
    [onMove],
  );
  const drop = useCallback(() => setCarried(null), []);

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
                key={widget.key}
                widget={widget}
                rect={board?.rects[widget.key] ?? null}
                pendingWidth={widget.span === 2 ? width : column}
                editing={editing}
                lifted={carried === widget.key}
                onMeasure={measure}
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
  pendingWidth: number;
  editing: boolean;
  lifted: boolean;
  onMeasure: (key: string, height: number) => void;
  onEdit: () => void;
  onLift: (key: string) => void;
  onCarry: (key: string, x: number, y: number) => void;
  onDrop: () => void;
  onStep: (key: string, delta: -1 | 1) => void;
  canStep: { earlier: boolean; later: boolean };
}

function Cell({ widget, rect, pendingWidth, editing, lifted, onMeasure, onEdit, onLift, onCarry, onDrop, onStep, canStep }: CellProps) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const plate = theme.edge.rest;
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Worklets copy what they close over, and a widget carries its React content; they get the key alone.
  const key = widget.key;
  const placed = useRef(false);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const w = useSharedValue(pendingWidth);
  const h = useSharedValue(0);
  const target = useSharedValue({ x: 0, y: 0 });
  const carrying = useSharedValue(false);
  const origin = useSharedValue({ x: 0, y: 0 });
  const offset = useSharedValue({ x: 0, y: 0 });
  const shown = useSharedValue(false);

  useEffect(() => {
    if (!rect) {
      w.set(pendingWidth);
      return;
    }
    const instant = !placed.current || reduceMotion;
    const to = (v: number) => (instant ? v : withTiming(v, SETTLE));
    target.set({ x: rect.x, y: rect.y });
    // The widget in hand follows the finger; it goes to its new place when it is let go.
    if (!carrying.get()) {
      x.set(to(rect.x));
      y.set(to(rect.y));
    }
    w.set(to(rect.width));
    h.set(to(rect.height));
    shown.set(true);
    placed.current = true;
  }, [rect, pendingWidth, reduceMotion, carrying, h, shown, target, w, x, y]);

  const frame = useAnimatedStyle(() => {
    const inHand = carrying.get();
    return {
      left: inHand ? origin.get().x + offset.get().x : x.get(),
      top: inHand ? origin.get().y + offset.get().y : y.get(),
      width: w.get(),
      height: h.get(),
      opacity: shown.get() ? 1 : 0,
      zIndex: inHand ? 10 : 0,
      transform: [{ scale: withTiming(inHand ? 1.03 : 1, { duration: 120 }) }],
    };
  });

  const move = Gesture.Pan()
    .enabled(editing)
    .minDistance(2)
    .onStart(() => {
      origin.set({ x: x.get(), y: y.get() });
      offset.set({ x: 0, y: 0 });
      carrying.set(true);
      scheduleOnRN(onLift, key);
    })
    .onUpdate((e) => {
      offset.set({ x: e.translationX, y: e.translationY });
      const middle = { x: origin.get().x + e.translationX + w.get() / 2, y: origin.get().y + e.translationY + h.get() / 2 };
      scheduleOnRN(onCarry, key, middle.x, middle.y);
    })
    .onFinalize(() => {
      if (!carrying.get()) return;
      x.set(origin.get().x + offset.get().x);
      y.set(origin.get().y + offset.get().y);
      carrying.set(false);
      x.set(withTiming(target.get().x, SETTLE));
      y.set(withTiming(target.get().y, SETTLE));
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
        style={[styles.cell, frame]}
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
