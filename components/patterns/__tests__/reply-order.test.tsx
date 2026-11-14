// A reply opens with what Goose is thinking, one line at its top, then what its tools did, then the
// words. A quip holds the line only until thinking comes, and the Pond's "Agent working" is never
// drawn. Done, the reply reads in order, with reading aloud and copying beside its chip.

import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { MessageRow } from '@/components/patterns/message-row';
import type { Message } from '@/models/chat';

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
// The goose runs on Reanimated's worklets, which jest's stand-ins cannot carry; its motion has tests of its own.
jest.mock('@/components/patterns/goose', () => ({ Goose: () => null }));
// The swipe runs on gesture-handler and worklets, which jest's stand-ins cannot carry; the sheet and viewer are modals.
jest.mock('@/components/patterns/swipe-to-reply', () => ({ SwipeToReply: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/patterns/picture-viewer', () => ({ PictureViewer: () => null }));
jest.mock('@/components/patterns/reply-part-sheet', () => ({ ReplyPartSheet: () => null }));
jest.mock('@/components/patterns/pond-picture', () => ({ PondPicture: (props: { path: string }) => `pond:${props.path}` }));
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
jest.mock('@/components/patterns/voice-note-mic', () => ({ clockWords: () => '' }));
jest.mock('@/components/patterns/message-note', () => ({ FromLine: () => null, OfferPanel: () => null, ReceiptChips: () => null }));
jest.mock('@/components/patterns/thinking-quips', () => {
  const { Text: T } = jest.requireActual('react-native');
  return { ThinkingQuips: () => <T>thinking</T> };
});
jest.mock('@/components/patterns/tool-card', () => {
  const { Text: T } = jest.requireActual('react-native');
  return { ToolTrail: () => <T>cards</T>, foldedTools: (tools: unknown[]) => tools };
});
jest.mock('@/components/patterns/answer-trail', () => {
  const { Text: T } = jest.requireActual('react-native');
  return {
    TrailChip: () => <T>chip</T>,
    TrailSheet: () => null,
    useTrail: () => ({ sources: [], chips: undefined, focus: null, mounted: false }),
  };
});
jest.mock('@/components/patterns/cited-sources', () => {
  const { Text: T } = jest.requireActual('react-native');
  return { PagePictures: () => <T>pictures</T> };
});
jest.mock('@/components/patterns/copy-button', () => {
  const { Text: T } = jest.requireActual('react-native');
  return { ACTION_HEIGHT: 24, CopyButton: ({ text }: { text: string }) => <T>{`copy:${text}`}</T> };
});
const mockToggle = jest.fn();
jest.mock('@/view-models/use-read-aloud', () => ({ useReadAloud: () => ({ reading: false, toggle: mockToggle }) }));
jest.mock('@/view-models/use-page-pictures', () => ({ usePagePictures: () => [] }));
jest.mock('@/services/voice-io', () => ({ playFile: jest.fn() }));
jest.mock('@/services/api-client', () => ({ api: {} }));
jest.mock('@/services/haptics', () => ({ selectionTick: jest.fn(async () => {}) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tools = [{ id: 'c1', name: 'giap-knowledge__search_web', args: '{}', status: 'ok' as const, result: 'pages' }];

async function draw(message: Message): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<MessageRow message={message} position="only" turnSeed={0} />);
  });
  return tree;
}

/** Each drawn line, in the order a reader meets them. */
function lines(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .filter((node) => !node.parent || node.parent.type !== Text)
    .map((node) => [node.props.children].flat().join(''));
}

it('puts a quip at the top before anything else comes, over what the tools did', async () => {
  const tree = await draw({ id: 'a', role: 'assistant', content: '', pending: true, tools, timestamp: 0 });
  expect(lines(tree)).toEqual(['thinking', 'chip', 'cards']);
});

it('swaps the quip for the newest line of thinking once it starts, and draws no status', async () => {
  const thinking = ['The user wants the ', 'drive time.\nSonoma is about an hour ', 'from San Francisco'];
  const waiting = await draw({ id: 'a', role: 'assistant', content: '', pending: true, tools, thinking, timestamp: 0 });
  expect(lines(waiting)).toEqual(['Sonoma is about an hour from San Francisco', 'chip', 'cards']);

  const writing = await draw({ id: 'a', role: 'assistant', content: 'About an hour', pending: true, tools, thinking, timestamp: 0 });
  expect(lines(writing)).toEqual(['Sonoma is about an hour from San Francisco', 'chip', 'cards', 'About an hour']);
});

it('reads in order once done, with reading aloud and copying beside the chip', async () => {
  const content = 'Run `npm test`:\n\n```bash\nnpm test\n```';
  const tree = await draw({ id: 'a', role: 'assistant', content, tools, thinking: ['Find the command.'], timestamp: 0 });
  const drawn = lines(tree);
  expect(drawn[0]).toBe('Find the command.');
  expect(drawn.indexOf('chip')).toBeGreaterThan(drawn.findIndex((l) => l.startsWith('Run')));
  expect(drawn).toContain(`copy:${content}`);
  expect(drawn.indexOf('pictures')).toBeGreaterThan(drawn.indexOf('chip'));
  expect(drawn.indexOf('cards')).toBeGreaterThan(drawn.indexOf('pictures'));

  const read = tree.root.find((n: ReactTestInstance) => n.props.accessibilityLabel === 'Read aloud' && Boolean(n.props.onPress));
  act(() => read.props.onPress());
  expect(mockToggle).toHaveBeenCalledWith(content);
});

it("draws a reply's quote above the bubble, and a photo from the Pond through its connection", async () => {
  const tree = await draw({
    id: 'u',
    role: 'user',
    content: '> Goose said:\n> Jarida builds privacy-first software.\n\nWho funds it?',
    images: [{ id: 'p', uri: '/api/v1/attachments/p', local: false }],
    timestamp: 0,
  });
  const drawn = lines(tree);
  expect(drawn).toContain('Goose said:');
  expect(drawn).toContain('Jarida builds privacy-first software.');
  expect(drawn).toContain('Who funds it?');
  expect(drawn.some((l) => l.startsWith('>'))).toBe(false);
  expect(JSON.stringify(tree.toJSON())).toContain('pond:/api/v1/attachments/p');
});
