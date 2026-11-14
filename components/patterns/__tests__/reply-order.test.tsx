// While Goose writes, the place it is writing is the foot of its reply, so the thread, pinned to its
// foot, keeps it in view: what its tools did sits above the words until the reply is done. Done, the
// reply reads in order, with reading aloud and copying beside its chip.

import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { MessageRow } from '@/components/patterns/message-row';
import type { Message } from '@/models/chat';

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
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
    tree = create(<MessageRow message={message} position="only" status="Reading pages" turnSeed={0} />);
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

it('keeps the words being written at the foot, under what the tools did', async () => {
  const tree = await draw({ id: 'a', role: 'assistant', content: 'Jarida builds', pending: true, tools, timestamp: 0 });
  expect(lines(tree)).toEqual(['chip', 'cards', 'Jarida builds', 'Reading pages']);
});

it('keeps the thinking line at the foot before any words come', async () => {
  const tree = await draw({ id: 'a', role: 'assistant', content: '', pending: true, tools, timestamp: 0 });
  expect(lines(tree)).toEqual(['chip', 'cards', 'thinking']);
});

it('reads in order once done, with reading aloud and copying beside the chip', async () => {
  const content = 'Run `npm test`:\n\n```bash\nnpm test\n```';
  const tree = await draw({ id: 'a', role: 'assistant', content, tools, timestamp: 0 });
  const drawn = lines(tree);
  expect(drawn.indexOf('chip')).toBeGreaterThan(drawn.findIndex((l) => l.startsWith('Run')));
  expect(drawn).toContain(`copy:${content}`);
  expect(drawn.indexOf('pictures')).toBeGreaterThan(drawn.indexOf('chip'));
  expect(drawn.indexOf('cards')).toBeGreaterThan(drawn.indexOf('pictures'));

  const read = tree.root.find((n: ReactTestInstance) => n.props.accessibilityLabel === 'Read aloud' && Boolean(n.props.onPress));
  act(() => read.props.onPress());
  expect(mockToggle).toHaveBeenCalledWith(content);
});
