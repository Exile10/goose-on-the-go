// A reply chosen in the thread shows over the composer, goes out as a quote ahead of the words,
// and a reply to a picture carries the picture, which leaves again if the reply is set aside.

import React from 'react';
import { TextInput } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { ChatDock, type ChatDockProps } from '@/components/patterns/chat-dock';
import type { ReplyTarget } from '@/services/reply';

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
// The held microphone runs on gesture-handler, which this Reanimated stand-in cannot carry.
jest.mock('@/components/patterns/voice-note-mic', () => ({ VoiceNoteMic: () => null, VoiceNoteStrip: () => null }));
// The light and the note animate on SVG; none of it decides what is sent.
jest.mock('@/components/patterns/answering', () => ({
  AnsweringLight: () => null,
  AnsweringWash: () => null,
  AnsweringNote: () => null,
  useAnsweringLight: () => ({}),
  useAnsweringNote: () => ({ room: 0 }),
}));
// The menu is a modal of its own.
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

jest.mock('@/services/pond-images', () => ({ loadPondImage: jest.fn().mockResolvedValue('data:image/jpeg;base64,QUJD') }));

const goose: ReplyTarget = { kind: 'text', from: 'goose', text: 'Jarida builds privacy-first software.', part: false };
const picture: ReplyTarget = { kind: 'picture', from: 'goose', picture: { uri: '/api/v1/report-images/k', local: false, label: 'Hills at dusk' } };

async function mount(replyTo: ReplyTarget | null) {
  const onSend = jest.fn();
  const onClearReply = jest.fn();
  const props = (r: ReplyTarget | null): ChatDockProps => ({
    onSend,
    onVoice: jest.fn(),
    onAttach: jest.fn().mockResolvedValue([]),
    replyTo: r,
    onClearReply,
  });
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<ChatDock {...props(replyTo)} />);
  });
  return {
    onSend,
    onClearReply,
    text: () => words(tree.root),
    ask: async (question: string) => {
      await act(async () => tree.root.findByType(TextInput).props.onChangeText(question));
      const [send] = tree.root.findAll((n) => n.props.accessibilityLabel === 'Send' && typeof n.props.onPress === 'function');
      await act(async () => send.props.onPress());
    },
    cancel: () =>
      act(async () => tree.root.find((n) => n.props.accessibilityLabel === 'Stop replying' && Boolean(n.props.onPress)).props.onPress()),
    set: (r: ReplyTarget | null) => act(async () => tree.update(<ChatDock {...props(r)} />)),
    thumbs: () =>
      tree.root.findAll(
        (n) => typeof n.type === 'string' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Remove'),
      ),
    unmount: () => act(async () => tree.unmount()),
  };
}

it('shows what it answers, and sends the quote ahead of the words', async () => {
  const dock = await mount(goose);
  expect(dock.text()).toContain('Replying to Goose');
  expect(dock.text()).toContain('Jarida builds privacy-first software.');
  await dock.ask('Who funds it?');
  expect(dock.onSend).toHaveBeenLastCalledWith('> Goose said:\n> Jarida builds privacy-first software.\n\nWho funds it?', [], undefined);
  expect(dock.onClearReply).toHaveBeenCalled();
  await dock.unmount();
});

it('sets the reply aside on the cross', async () => {
  const dock = await mount(goose);
  await dock.cancel();
  expect(dock.onClearReply).toHaveBeenCalled();
  await dock.unmount();
});

it('carries a picture it answers, and lets it go with the reply', async () => {
  const dock = await mount(picture);
  expect(dock.text()).toContain("Replying to Goose's picture");
  expect(dock.thumbs()).toHaveLength(1);
  await dock.set(null);
  expect(dock.thumbs()).toHaveLength(0);

  await dock.set(picture);
  await dock.ask('What hills are these?');
  const [text, attachments] = dock.onSend.mock.calls.at(-1);
  expect(text).toBe('> About your picture:\n> Hills at dusk\n\nWhat hills are these?');
  expect(attachments).toEqual([expect.objectContaining({ kind: 'image', base64: 'QUJD' })]);
  await dock.unmount();
});
