/**
 * Every press is felt once: GPressable taps by default, Ink's pressable components feel through
 * components/ui/ink.tsx, and a handler that gives its own feel first keeps it, because haptics
 * drops a second press feel within its window.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';

import { GPressable } from '@/components/ui/g-pressable';
import * as AppInk from '@/components/ui/ink';
import { PRESS_WINDOW_MS, resetPressWindow, selectionTick, tap } from '@/services/haptics';

const mockHaptics = { impactAsync: jest.fn(), selectionAsync: jest.fn(), notificationAsync: jest.fn() };
jest.mock('expo-haptics', () => ({
  impactAsync: (...a: unknown[]) => mockHaptics.impactAsync(...a),
  selectionAsync: (...a: unknown[]) => mockHaptics.selectionAsync(...a),
  notificationAsync: (...a: unknown[]) => mockHaptics.notificationAsync(...a),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetPressWindow();
});

function press(element: React.ReactElement) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(element);
  });
  act(() => {
    // [0] is GPressable, holding the handler as given; [1] is the Pressable it renders, with
    // the feel added. Pressing [1] is pressing the screen.
    tree.root.findAll((n) => typeof n.props.onPress === 'function')[1].props.onPress({});
  });
}

describe('GPressable', () => {
  it('taps when pressed, after the handler', () => {
    const order: string[] = [];
    mockHaptics.impactAsync.mockImplementation(() => order.push('feel'));
    press(<GPressable onPress={() => order.push('handler')} />);
    expect(order).toEqual(['handler', 'feel']);
    expect(mockHaptics.impactAsync).toHaveBeenCalledWith('light');
  });

  it('stays silent when asked to, and ticks for a choice', () => {
    press(<GPressable haptic="none" onPress={() => undefined} />);
    expect(mockHaptics.impactAsync).not.toHaveBeenCalled();
    resetPressWindow();
    press(<GPressable haptic="selection" onPress={() => undefined} />);
    expect(mockHaptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it("keeps a handler's own feel instead of adding a second", () => {
    press(<GPressable onPress={() => void selectionTick()} />);
    expect(mockHaptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(mockHaptics.impactAsync).not.toHaveBeenCalled();
  });
});

describe('the press window', () => {
  it('drops a second press feel inside it, and allows one after it', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    void tap();
    void tap();
    expect(mockHaptics.impactAsync).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000 + PRESS_WINDOW_MS);
    void tap();
    expect(mockHaptics.impactAsync).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });
});

describe('Ink through the app', () => {
  it("exports this app's pressable components, not Ink's own", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Base = require('@jarida/ink/native');
    const app: Record<string, unknown> = { ...AppInk };
    for (const name of ['InkButton', 'InkCard', 'InkChip', 'InkChoice', 'InkSegmented', 'InkSwitch', 'InkCheckbox', 'InkListItem', 'InkSelect', 'InkRadioGroup', 'InkMenu']) {
      expect(app[name]).not.toBe(Base[name]);
    }
    // Everything else passes through unchanged.
    expect(AppInk.InkText).toBe(Base.InkText);
  });

  it('gives a handler its feel after it runs, and leaves an absent handler absent', () => {
    const order: string[] = [];
    const felt = AppInk.withFeel(() => order.push('handler'), async () => {
      order.push('feel');
    });
    felt?.();
    expect(order).toEqual(['handler', 'feel']);
    expect(AppInk.withFeel(undefined, tap)).toBeUndefined();
  });
});
