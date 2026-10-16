/**
 * Tracks the finger 1:1 once a drag is plainly sideways, and keeps it from the page's scroll from
 * then on; until then a vertical swipe across it scrolls the page and changes nothing. A tap sets
 * the value where it lands. Reports the settled value apart from the ones it passed, so a caller
 * saves once per drag, not per frame.
 * Drawn as pond-desktop's pace slider; `InkSlider` reads `locationX`, which jumps once the finger
 * is over the thumb, and lets the page's scroll take the drag.
 */

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { View, type AccessibilityActionEvent, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import { selectionTick } from '@/services/haptics';
import { useSettingsColors, useSettingsMetrics } from './settings-theme';

const THUMB = 22;
const TRACK = 6;
/** The thumb's plate, offset as Ink's compact edge is: small enough not to read as toppling. */
const PLATE = 2;
/** How far a finger moves, mostly sideways, before it is a drag rather than the start of a scroll. */
const SLOP = 8;

function snap(raw: number, min: number, max: number, step: number): number {
  const stepped = Math.round((raw - min) / step) * step + min;
  // Rounding steps such as 0.05 drifts in binary; keep what the step can express.
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Math.min(max, Math.max(min, Number(stepped.toFixed(decimals))));
}

export function SettingsSlider({
  value,
  min,
  max,
  step,
  label,
  valueText,
  onChange,
  onCommit,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  valueText: string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  disabled?: boolean;
}) {
  const colors = useSettingsColors();
  const m = useSettingsMetrics();
  const [width, setWidth] = useState(0);
  const pageX = useRef(0);
  const trackRef = useRef<View>(null);
  const start = useRef({ x: 0, y: 0, dragging: false });

  const latest = useRef({ value, min, max, step, width, onChange, onCommit, disabled });
  useLayoutEffect(() => {
    latest.current = { value, min, max, step, width, onChange, onCommit, disabled };
  });

  const valueAt = (x: number) => {
    const st = latest.current;
    const travel = Math.max(1, st.width - THUMB);
    const ratio = Math.min(1, Math.max(0, (x - pageX.current - THUMB / 2) / travel));
    return snap(st.min + ratio * (st.max - st.min), st.min, st.max, st.step);
  };

  const move = (x: number) => {
    const next = valueAt(x);
    if (next !== latest.current.value) latest.current.onChange(next);
    return next;
  };

  // The View's own responder props: handlers that run on touch, never during render.
  const touch = {
    onStartShouldSetResponder: () => !latest.current.disabled,
    onMoveShouldSetResponder: () => !latest.current.disabled,
    // Measured on every grant: the page may have scrolled since layout.
    onResponderGrant: (event: GestureResponderEvent) => {
      start.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, dragging: false };
      trackRef.current?.measureInWindow((left) => {
        pageX.current = left;
      });
    },
    onResponderMove: (event: GestureResponderEvent) => {
      const { pageX: x, pageY: y } = event.nativeEvent;
      const st = start.current;
      if (!st.dragging) {
        const dx = Math.abs(x - st.x);
        if (dx < SLOP || dx < Math.abs(y - st.y)) return;
        st.dragging = true;
      }
      move(x);
    },
    onResponderRelease: (event: GestureResponderEvent) => {
      latest.current.onCommit(move(event.nativeEvent.pageX));
    },
    // The scroll may have it until the drag is sideways, and never after.
    onResponderTerminationRequest: () => !start.current.dragging,
    onResponderTerminate: () => {
      if (start.current.dragging) latest.current.onCommit(latest.current.value);
    },
  };

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
    trackRef.current?.measureInWindow((left) => {
      pageX.current = left;
    });
  }, []);

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const delta = event.nativeEvent.actionName === 'increment' ? step : -step;
      const next = snap(value + delta, min, max, step);
      if (next === value) return;
      void selectionTick();
      onChange(next);
      onCommit(next);
    },
    [value, min, max, step, onChange, onCommit],
  );

  const ratio = max === min ? 0 : (value - min) / (max - min);
  const left = ratio * Math.max(0, width - THUMB);

  return (
    <View
      ref={trackRef}
      onLayout={onLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: valueText }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAccessibilityAction}
      style={{ height: 36, justifyContent: 'center', opacity: disabled ? 0.45 : 1 }}
      {...touch}
    >
      <View
        style={{
          height: TRACK,
          borderRadius: m.radius.pill,
          backgroundColor: colors.line,
          borderWidth: m.hairline,
          borderColor: colors.edge,
          overflow: 'hidden',
        }}
      >
        <View style={{ width: left + THUMB / 2, height: '100%', backgroundColor: colors.accent }} />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: left + PLATE,
          width: THUMB,
          height: THUMB,
          marginTop: PLATE,
          borderRadius: THUMB / 2,
          backgroundColor: colors.ink,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left,
          width: THUMB,
          height: THUMB,
          borderRadius: THUMB / 2,
          backgroundColor: colors.group,
          borderWidth: m.border,
          borderColor: colors.edge,
        }}
      />
    </View>
  );
}
