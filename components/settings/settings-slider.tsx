/**
 * Tracks the finger 1:1 from touch-down and keeps the gesture from the page's scroll; reports the
 * settled value apart from the ones it passed, so a caller saves once per drag, not per frame.
 */

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { View, type AccessibilityActionEvent, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import { Brand } from '@/constants/colors';
import { Radii } from '@/constants/radii';
import { selectionTick } from '@/services/haptics';
import { useSettingsColors } from './settings-theme';

const THUMB = 26;
const TRACK = 6;

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
  const [width, setWidth] = useState(0);
  const pageX = useRef(0);
  const trackRef = useRef<View>(null);

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
      const x = event.nativeEvent.pageX;
      trackRef.current?.measureInWindow((left) => {
        pageX.current = left;
        move(x);
      });
    },
    onResponderMove: (event: GestureResponderEvent) => {
      move(event.nativeEvent.pageX);
    },
    onResponderRelease: (event: GestureResponderEvent) => {
      latest.current.onCommit(move(event.nativeEvent.pageX));
    },
    onResponderTerminationRequest: () => false,
    onResponderTerminate: () => latest.current.onCommit(latest.current.value),
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
      <View style={{ height: TRACK, borderRadius: Radii.pill, backgroundColor: colors.line }} />
      <View
        style={{
          position: 'absolute',
          left: 0,
          width: left + THUMB / 2,
          height: TRACK,
          borderRadius: Radii.pill,
          backgroundColor: colors.accent,
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
          backgroundColor: Brand.white,
          shadowColor: Brand.charcoal,
          shadowOpacity: 0.22,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 1 },
          elevation: 3,
        }}
      />
    </View>
  );
}
