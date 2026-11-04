/**
 * The keyboard never covers the field being typed in.
 *
 * `GKeyboardView` lifts its container by the keyboard's height; that alone left
 * Settings > Memory's number fields under the keyboard, because the page inside
 * only got shorter and nothing scrolled the field back into what was left. These
 * pin the scroll that does, the padding under it, and that every scroller that
 * sits under a `GKeyboardView` takes part rather than only the ones a bug report
 * happened to name.
 */

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { SettingsScroll } from '@/components/settings/settings-scroll';
import { GKeyboardScrollView, GKeyboardView, REVEAL_MARGIN } from '../g-keyboard-view';

jest.mock('@/components/settings/settings-theme', () => ({
  useSettingsColors: () => ({ page: '#fff' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

type Listener = (e: { endCoordinates: { height: number } }) => void;

const listeners = new Map<string, Set<Listener>>();
const emit = (event: string, height = 0) =>
  act(() => {
    listeners.get(event)?.forEach((fn) => fn({ endCoordinates: { height } }));
  });
const ios = Platform.OS === 'ios';
const showKeyboard = (height: number) => emit(ios ? 'keyboardWillShow' : 'keyboardDidShow', height);
const hideKeyboard = () => emit(ios ? 'keyboardWillHide' : 'keyboardDidHide');

/** Where the scroller and the focused field are on screen: `[top, height]`. */
let scrollerFrame: [number, number];
let fieldFrame: [number, number] | null;

beforeEach(() => {
  listeners.clear();
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, fn: Listener) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
    return { remove: () => listeners.get(event)?.delete(fn) };
  }) as unknown as typeof Keyboard.addListener);

  scrollerFrame = [100, 500];
  fieldFrame = null;
  jest.spyOn(ScrollView.prototype, 'getNativeScrollRef').mockImplementation(
    () =>
      ({
        measureInWindow: (cb: (...n: number[]) => void) => cb(0, scrollerFrame[0], 400, scrollerFrame[1]),
      }) as unknown as ReturnType<ScrollView['getNativeScrollRef']>,
  );
  (TextInput as unknown as { State: unknown }).State = {
    currentlyFocusedInput: () =>
      fieldFrame && {
        measureInWindow: (cb: (...n: number[]) => void) => cb(16, fieldFrame![0], 300, fieldFrame![1]),
      },
  };
});

afterEach(() => {
  jest.restoreAllMocks();
  (ScrollView.prototype as unknown as { scrollTo: jest.Mock }).scrollTo.mockClear();
});

function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element);
  });
  return tree;
}

const scrollTo = () => (ScrollView.prototype as unknown as { scrollTo: jest.Mock }).scrollTo;

function page() {
  return render(
    <GKeyboardScrollView>
      <View />
    </GKeyboardScrollView>,
  );
}

/** The scroller is laid out at `height`, as it is after the keyboard shrinks it. */
function layOut(tree: ReactTestRenderer, height: number) {
  act(() => {
    tree.root.findByType(ScrollView).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height } } });
  });
}

function scrolledTo(tree: ReactTestRenderer, y: number) {
  act(() => {
    tree.root.findByType(ScrollView).props.onScroll({ nativeEvent: { contentOffset: { x: 0, y } } });
  });
}

describe('GKeyboardView', () => {
  it('lifts its content by the keyboard while it is up, and lets it back down', () => {
    const tree = render(
      <GKeyboardView offset={8}>
        <View />
      </GKeyboardView>,
    );
    const padding = () => StyleSheet.flatten(tree.root.findAllByType(View)[0].props.style).paddingBottom;

    expect(padding()).toBeUndefined();
    showKeyboard(300);
    expect(padding()).toBe(308);
    hideKeyboard();
    expect(padding()).toBeUndefined();
  });
});

describe('GKeyboardScrollView', () => {
  it('scrolls a field the keyboard shrank the page over to just above the keyboard', () => {
    const tree = page();
    layOut(tree, 800);
    scrolledTo(tree, 50);
    // Low on the page: its bottom, 740, is past the shrunken page's bottom, 600.
    fieldFrame = [700, 40];

    showKeyboard(300);
    layOut(tree, 500);

    expect(scrollTo()).toHaveBeenCalledTimes(1);
    expect(scrollTo()).toHaveBeenCalledWith({ y: 50 + 740 + REVEAL_MARGIN - 600, animated: true });
  });

  it('leaves a field that is already in view where it is', () => {
    const tree = page();
    layOut(tree, 800);
    fieldFrame = [200, 40];

    showKeyboard(300);
    layOut(tree, 500);

    expect(scrollTo()).not.toHaveBeenCalled();
  });

  it('leaves the page alone when the field is in another surface above it', () => {
    const tree = page();
    layOut(tree, 800);
    // A sheet's field: above the top of this page's scroller, not below its bottom.
    fieldFrame = [40, 40];

    showKeyboard(300);
    layOut(tree, 500);

    expect(scrollTo()).not.toHaveBeenCalled();
  });

  it('reveals the next field when focus moves under a keyboard that is already up', () => {
    const tree = page();
    layOut(tree, 800);
    showKeyboard(300);
    layOut(tree, 500);
    fieldFrame = [620, 40];

    // The same keyboard, re-announced: no layout follows it.
    showKeyboard(300);

    expect(scrollTo()).toHaveBeenCalledWith({ y: 660 + REVEAL_MARGIN - 600, animated: true });
  });

  it('does nothing on a relayout while the keyboard is down', () => {
    const tree = page();
    fieldFrame = [700, 40];
    layOut(tree, 800);
    layOut(tree, 500);

    expect(scrollTo()).not.toHaveBeenCalled();
  });

  it('keeps taps on the page while the keyboard is up', () => {
    expect(page().root.findByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
  });
});

describe('SettingsScroll', () => {
  it('is the keyboard-aware page when it has fields, and a plain one when it has none', () => {
    const typing = render(
      <SettingsScroll typing>
        <View />
      </SettingsScroll>,
    );
    const reading = render(
      <SettingsScroll>
        <View />
      </SettingsScroll>,
    );

    expect(typing.root.findAllByType(GKeyboardScrollView)).toHaveLength(1);
    expect(reading.root.findAllByType(GKeyboardView)).toHaveLength(0);
  });
});

describe('every scroller under the keyboard', () => {
  const root = path.resolve(__dirname, '../../..');

  /**
   * Files that use `GKeyboardView` around a scroller without the reveal, and why
   * that is right for them. The conversation's only field is the composer, which
   * sits below its message list rather than in it, and `GKeyboardView` lifting
   * the composer is the whole of what it needs.
   */
  const EXEMPT = new Set(['app/conversation.tsx']);

  function sources(dir: string): string[] {
    return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(rel);
      return /\.tsx$/.test(entry.name) ? [rel] : [];
    });
  }

  it('reveals the focused field', () => {
    const missing = [...sources('app'), ...sources('components')].filter((file) => {
      if (EXEMPT.has(file) || file === 'components/ui/g-keyboard-view.tsx') return false;
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      const lifted = /<GKeyboardView\b/.test(source);
      const scrolls = /<(ScrollView|FlatList|SectionList)\b/.test(source);
      return lifted && scrolls && !source.includes('useFocusedInputReveal(');
    });

    expect(missing).toEqual([]);
  });
});
