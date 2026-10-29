// The composer's research mode asks how much to write: the Pond decides until the person picks, and
// the pick goes with each research question for as long as the composer is up.

import React from 'react';
import { TextInput } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { ChatDock, type ChatDockProps } from '@/components/patterns/chat-dock';

// Reanimated's own mock needs the native worklets runtime; the dock only pads by a shared value.
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View },
    Easing: { out: () => undefined, cubic: undefined },
    useSharedValue: (value: number) => ({ get: () => value, set: () => undefined }),
    useAnimatedStyle: (style: () => object) => style(),
    withTiming: (value: number) => value,
  };
});
// The light and the note animate on SVG; none of it decides what is sent.
jest.mock('@/components/patterns/answering', () => ({
  AnsweringLight: () => null,
  AnsweringWash: () => null,
  AnsweringNote: () => null,
  useAnsweringLight: () => ({}),
  useAnsweringNote: () => ({ room: 0 }),
}));
// The menu is a modal of its own; the test chooses research through the prop the dock hands it.
const mockMenu: { onResearch?: () => void } = {};
jest.mock('@/components/patterns/attach-menu', () => ({
  AttachMenu: (props: { onResearch?: () => void }) => {
    mockMenu.onResearch = props.onResearch;
    return null;
  },
}));
// lucide is not transformed under jest.
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
jest.mock('@/services/haptics', () => ({
  selectionTick: jest.fn().mockResolvedValue(undefined),
  tap: jest.fn().mockResolvedValue(undefined),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Ink says once that it cannot draw the chip's icon under jest.
let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

function words(node: ReactTestInstance): string {
  const out: string[] = [];
  const walk = (n: ReactTestInstance | string) => {
    if (typeof n === 'string') out.push(n);
    else n.children.forEach(walk);
  };
  walk(node);
  return out.join('');
}

async function mount(conversation: string | null) {
  const onSend = jest.fn();
  const props = (c: string | null): ChatDockProps => ({
    onSend,
    onVoice: jest.fn(),
    onAttach: jest.fn().mockResolvedValue([]),
    research: 'available',
    conversation: c,
  });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<ChatDock {...props(conversation)} />);
  });

  const group = () => tree.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'radiogroup');
  const radios = () =>
    group()[0]?.findAll((n) => n.props.accessibilityRole === 'radio' && typeof n.props.onPress === 'function') ?? [];
  return {
    onSend,
    group,
    picked: () => radios().filter((r) => r.props.accessibilityState?.checked).map(words).join(', '),
    text: () => words(tree.root),
    research: () => act(async () => mockMenu.onResearch?.()),
    pick: (label: string) => act(async () => radios().find((r) => words(r) === label)!.props.onPress()),
    ask: async (question: string) => {
      await act(async () => tree.root.findByType(TextInput).props.onChangeText(question));
      const [send] = tree.root.findAll((n) => n.props.accessibilityLabel === 'Send' && typeof n.props.onPress === 'function');
      await act(async () => send.props.onPress());
    },
    move: (c: string | null) => act(async () => tree.update(<ChatDock {...props(c)} />)),
    unmount: () => act(async () => tree.unmount()),
  };
}

it('offers no choice until research is on, then lets the Pond decide', async () => {
  const dock = await mount('s1');
  expect(dock.group()).toHaveLength(0);
  await dock.research();
  expect(dock.group()[0].props.accessibilityLabel).toBe('How much to write');
  expect(dock.picked()).toBe('Pond decides');
  expect(dock.text()).toContain('Short for a quick question, a report for a big one.');

  await dock.ask('Is a flat roof fine for panels?');
  expect(dock.onSend).toHaveBeenLastCalledWith('Is a flat roof fine for panels?', [], { research: true, answer: 'auto' });
  expect(dock.group()).toHaveLength(0);
  await dock.unmount();
});

it('sends the pick, and keeps it for the next research here or in another conversation', async () => {
  const dock = await mount('s1');
  await dock.research();
  await dock.pick('Short answer');
  expect(dock.picked()).toBe('Short answer');
  expect(dock.text()).toContain('A few sentences, here in the chat.');
  await dock.ask('Is a flat roof fine for panels?');
  expect(dock.onSend).toHaveBeenLastCalledWith('Is a flat roof fine for panels?', [], { research: true, answer: 'short' });

  await dock.research();
  expect(dock.picked()).toBe('Short answer');
  await dock.pick('Full report');
  expect(dock.text()).toContain('Sections with sources, to read and export.');

  await dock.move('s2');
  expect(dock.group()).toHaveLength(0);
  await dock.research();
  expect(dock.picked()).toBe('Full report');
  await dock.ask('Compare panels for a flat roof');
  expect(dock.onSend).toHaveBeenLastCalledWith('Compare panels for a flat roof', [], { research: true, answer: 'report' });
  await dock.unmount();
});

it('sends a plain message with nothing about research', async () => {
  const dock = await mount('s1');
  await dock.ask('Hello');
  expect(dock.onSend).toHaveBeenLastCalledWith('Hello', [], undefined);
  await dock.unmount();
});
