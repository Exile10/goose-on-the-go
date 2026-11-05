/**
 * A measured widget is drawn by React's own style, so an animated value that never reaches the view
 * cannot hide it. The Reanimated stand-in below models that loss exactly: a shared value written
 * after mount never changes what is rendered, and an animated style keeps its first-render values.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import '@/services/i18n';
import { WidgetBoard, type BoardWidget } from '../widget-board';

jest.mock('react-native-reanimated', () => {
  const { useRef } = jest.requireActual('react');
  const { View: Plain } = jest.requireActual('react-native');
  const transition = { duration: () => transition, easing: () => transition };
  return {
    __esModule: true,
    default: { View: Plain },
    Easing: { out: () => undefined, cubic: undefined },
    LinearTransition: transition,
    useSharedValue: (value: unknown) => useRef({ get: () => value, set: () => undefined }).current,
    useAnimatedStyle: (style: () => object) => useRef(style()).current,
    withTiming: (value: unknown) => value,
  };
});
jest.mock('react-native-gesture-handler', () => {
  const { View: Plain } = jest.requireActual('react-native');
  const gesture: object = new Proxy({}, { get: () => () => gesture });
  return {
    Gesture: gesture,
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    GestureHandlerRootView: Plain,
  };
});
jest.mock('react-native-worklets', () => ({ scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args) }));
const mockFocus: { pass?: () => void } = {};
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    mockFocus.pass = effect;
  },
}));
// lucide is not transformed under jest.
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
jest.mock('@/services/haptics', () => ({ tap: jest.fn(), selectionTick: jest.fn() }));

const widget = (key: string): BoardWidget => ({
  key,
  span: 2,
  frame: 'plain',
  title: key,
  icon: 'home',
  node: <Text>{key}</Text>,
});

const layout = (height: number, width = 360) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });

function Board({ keys, offline = false }: { keys: string[]; offline?: boolean }) {
  return offline ? null : (
    <WidgetBoard widgets={keys.map(widget)} editing={false} onEdit={jest.fn()} onMove={jest.fn()} onStep={jest.fn()} />
  );
}

/** The views that report a layout, from the widget's text outward: its content, then its frame. */
function views(tree: ReactTestRenderer, key: string) {
  const found: ReactTestInstance[] = [];
  let node: ReactTestInstance | null = tree.root.findAll((n) => n.props.children === key)[0];
  while (node && found.length < 2) {
    if (node.type === View && node.props.onLayout) found.push(node);
    node = node.parent;
  }
  const [content, frame] = found;
  return { content, frame, style: StyleSheet.flatten(frame.props.style) };
}

async function mount(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

async function lay(tree: ReactTestRenderer, heights: Record<string, number>) {
  const board = tree.root.findAll((n) => n.type === View && n.props.onLayout && n.props.style?.height !== undefined)[0];
  await act(async () => board.props.onLayout(layout(0)));
  for (const [key, height] of Object.entries(heights)) {
    const { content, frame } = views(tree, key);
    await act(async () => {
      content.props.onLayout(layout(height));
      frame.props.onLayout(layout(height));
    });
  }
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => jest.restoreAllMocks());

describe('WidgetBoard', () => {
  it('draws a measured widget in its place without any animated value reaching it', async () => {
    const tree = await mount(<Board keys={['music', 'chats']} />);
    await lay(tree, { music: 80, chats: 120 });

    const music = views(tree, 'music').style;
    const chats = views(tree, 'chats').style;
    expect(music.opacity).not.toBe(0);
    expect(chats.opacity).not.toBe(0);
    expect(music.top).toBe(0);
    expect(chats.top).toBeGreaterThan(music.top as number);
    expect(chats.height).toBeGreaterThan(120);
  });

  it('keeps a widget hidden until it has been measured', async () => {
    const tree = await mount(<Board keys={['music']} />);
    await lay(tree, {});
    expect(views(tree, 'music').style).toMatchObject({ opacity: 0, height: 0 });
  });

  it('draws a widget that mounts with a known place at once', async () => {
    const tree = await mount(<Board keys={['music', 'chats']} />);
    await lay(tree, { music: 80, chats: 120 });
    const before = views(tree, 'chats').style;

    await act(async () => tree.update(<Board keys={['chats']} />));
    await act(async () => tree.update(<Board keys={['music', 'chats']} />));

    // No layout has been reported for the remounted widget: its place is the one the board knew.
    const music = views(tree, 'music').style;
    expect(music.opacity).not.toBe(0);
    expect(music.height).toBeGreaterThan(80);
    expect(views(tree, 'chats').style).toMatchObject({ top: before.top, height: before.height });
  });

  it('draws the board again after it went away while the Pond was offline', async () => {
    const tree = await mount(<Board keys={['music', 'chats']} />);
    await lay(tree, { music: 80, chats: 120 });

    await act(async () => tree.update(<Board keys={['music', 'chats']} offline />));
    await act(async () => tree.update(<Board keys={['music', 'chats']} />));
    await lay(tree, { music: 80, chats: 120 });

    for (const key of ['music', 'chats']) {
      const { style } = views(tree, key);
      expect(style.opacity).not.toBe(0);
      expect(style.height).toBeGreaterThan(0);
    }
  });

  it('mounts a placed widget again, and says so, when a focus pass finds it not drawn', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tree = await mount(<Board keys={['music', 'chats']} />);
    await lay(tree, { music: 80, chats: 120 });
    const stale = views(tree, 'music').frame;
    await act(async () => stale.props.onLayout(layout(0)));

    await act(async () => mockFocus.pass?.());

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toMatchObject({ kind: 'home_widget_hidden', key: 'music' });
    const fresh = views(tree, 'music');
    expect(fresh.frame).not.toBe(stale);
    expect(fresh.style.opacity).not.toBe(0);
    expect(fresh.style.height).toBeGreaterThan(80);
  });

  it('passes focus quietly when every placed widget is drawn', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tree = await mount(<Board keys={['music', 'chats']} />);
    await lay(tree, { music: 80, chats: 120 });

    await act(async () => mockFocus.pass?.());

    expect(warn).not.toHaveBeenCalled();
  });
});
