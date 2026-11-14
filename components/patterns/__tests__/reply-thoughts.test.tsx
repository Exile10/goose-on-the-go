// What Goose thought and noted, tucked into one line at the top of its reply: the newest line of it,
// opened to the whole on a tap, with the steps after the thinking.

import '@/services/i18n';
import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { InkProvider } from '@jarida/ink/native';

import { lastLine, ReplyThoughts, thoughtOf } from '../reply-thoughts';

jest.mock('@/services/haptics', () => ({ selectionTick: jest.fn(async () => {}) }));
// The goose runs on Reanimated's worklets, which jest's stand-ins cannot carry; its motion has tests of its own.
jest.mock('@/components/patterns/goose', () => ({ Goose: () => null }));
jest.mock('@/components/ui/g-icon', () => ({ GIcon: 'GIcon' }));
jest.mock('@/components/patterns/thinking-quips', () => {
  const { Text: T } = jest.requireActual('react-native');
  return { ThinkingQuips: () => <T>quip</T> };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(props: Partial<React.ComponentProps<typeof ReplyThoughts>>): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <InkProvider scheme="light" accent="Purple">
        <ReplyThoughts live={false} waiting={false} seed={0} {...props} />
      </InkProvider>,
    );
  });
  return tree;
}

const texts = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .filter((node) => !node.parent || node.parent.type !== Text)
    .map((node) => [node.props.children].flat().join(''));

const toggle = (tree: ReactTestRenderer) =>
  tree.root.find((node) => typeof node.type !== 'string' && node.props.accessibilityRole === 'button' && Boolean(node.props.onPress));

describe('the thinking line', () => {
  it('reads the streamed pieces as one text and shows its newest line, unmarked', () => {
    expect(thoughtOf(['The user ', 'asks about **drive** time.\n', '## Plan\n- Check the map'])).toBe(
      'The user asks about **drive** time.\n## Plan\n- Check the map',
    );
    expect(lastLine('First.\n\n**Second** line\n')).toBe('Second line');
  });

  it('is a quip while nothing has come, and nothing once a reply that thought nothing is done', () => {
    expect(texts(render({ live: true, waiting: true }))).toEqual(['quip']);
    expect(texts(render({ live: false, waiting: false }))).toEqual([]);
  });

  it('is one line until pressed, then the thinking and the steps in full', () => {
    const tree = render({ thinking: ['Weigh the ', 'routes.\nPick the coast road.'], steps: ['Let me check the map.'] });
    expect(texts(tree)).toEqual(['Pick the coast road.']);
    expect(toggle(tree).props.accessibilityState).toEqual({ expanded: false, busy: false });

    act(() => toggle(tree).props.onPress());
    const open = texts(tree).join('\n');
    expect(open).toContain('Weigh the routes.');
    expect(open).toContain('Let me check the map.');

    act(() => toggle(tree).props.onPress());
    expect(texts(tree)).toEqual(['Pick the coast road.']);
  });

  it('shows the newest step when there is no thinking', () => {
    expect(texts(render({ steps: ['Let me check the weather.'] }))).toEqual(['Let me check the weather.']);
  });
});
