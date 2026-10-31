/**
 * Home's ideas, drawn: nothing where there is nothing, a decision that reaches its handler and
 * holds both buttons while it is out, and Ask Goose whatever the Pond offers.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { InkButton, InkChip } from '@jarida/ink/native';

import { GPressable } from '@/components/ui/g-pressable';
import i18n from '@/services/i18n';
import type { ProposalRow } from '@/view-models/use-proposals';

import { AskRow, HomeIdeas, type HomeIdeasProps } from '../home-ideas';

// lucide ships ES modules Jest does not transform; the glyph is not under test.
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
// Reanimated's worklets do not exist under Jest; the bars have their own test.
jest.mock('@/components/ui/equalizer-bars', () => ({ EqualizerBars: () => null }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const ROW: ProposalRow = { id: 'p1', summary: 'Turn the porch light off at 23:00?', rationale: 'Five nights running.', expires: '' };

function props(over: Partial<HomeIdeasProps> = {}): HomeIdeasProps {
  return {
    proposals: [],
    moreProposals: 0,
    agent: null,
    deciding: null,
    outcome: null,
    onAccept: jest.fn(),
    onDecline: jest.fn(),
    ...over,
  };
}

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

const texts = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Text).flatMap((t) => (typeof t.props.children === 'string' ? [t.props.children] : []));

const button = (tree: ReactTestRenderer, label: string): ReactTestInstance =>
  tree.root.findAllByType(InkButton).find((b) => b.props.children === label)!;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => mockPush.mockReset());

describe('HomeIdeas', () => {
  it('draws nothing, heading included, when the Pond has offered nothing', async () => {
    const tree = await render(<HomeIdeas {...props()} />);
    expect(tree.toJSON()).toBeNull();
  });

  it('states a suggestion with its reason, and answers it in place', async () => {
    const onAccept = jest.fn();
    const onDecline = jest.fn();
    const tree = await render(<HomeIdeas {...props({ proposals: [ROW], onAccept, onDecline })} />);

    expect(texts(tree)).toEqual(expect.arrayContaining([ROW.summary, ROW.rationale]));
    act(() => button(tree, i18n.t('proposals.card.accept')).props.onPress());
    act(() => button(tree, i18n.t('proposals.card.decline')).props.onPress());
    expect(onAccept).toHaveBeenCalledWith('p1');
    expect(onDecline).toHaveBeenCalledWith('p1');
  });

  it('holds both answers while one is out, and says which', async () => {
    const tree = await render(<HomeIdeas {...props({ proposals: [ROW, { ...ROW, id: 'p2' }], deciding: 'p1' })} />);
    const buttons = tree.root.findAllByType(InkButton);
    expect(buttons.every((b) => b.props.disabled)).toBe(true);
    expect(buttons.filter((b) => b.props.children === i18n.t('proposals.card.deciding'))).toHaveLength(1);
  });

  it('offers the rest only when there are more', async () => {
    const tree = await render(<HomeIdeas {...props({ proposals: [ROW], moreProposals: 3 })} />);
    expect(texts(tree)).toContain(i18n.t('home.ideas.more', { count: 3 }));
    const solo = await render(<HomeIdeas {...props({ proposals: [ROW] })} />);
    expect(texts(solo)).not.toContain(i18n.t('home.ideas.more', { count: 0 }));
  });

  it('leads an agent idea to the Agents screen', async () => {
    const tree = await render(
      <HomeIdeas {...props({ agent: { template: 'welcome-back', title: 'Welcome back', when: 'When you come home' } })} />,
    );
    expect(texts(tree)).toEqual(
      expect.arrayContaining([i18n.t('home.ideas.agent', { title: 'Welcome back' }), 'When you come home']),
    );
    act(() => tree.root.findByType(GPressable).props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/(stack)/agents');
  });
});

describe('AskRow', () => {
  it('keeps Ask Goose when the Pond offers no question', async () => {
    const onAskGoose = jest.fn();
    const tree = await render(<AskRow prompts={[]} onAsk={jest.fn()} onAskGoose={onAskGoose} />);
    const chips = tree.root.findAllByType(InkChip);
    expect(chips).toHaveLength(1);
    act(() => chips[0].props.onPress());
    expect(onAskGoose).toHaveBeenCalled();
  });

  it('asks the question picked', async () => {
    const onAsk = jest.fn();
    const prompt = { id: 'a', prompt: 'What did power cost this week?', composed: true };
    const tree = await render(<AskRow prompts={[prompt]} onAsk={onAsk} onAskGoose={jest.fn()} />);
    act(() => tree.root.findAllByType(InkChip)[0].props.onPress());
    expect(onAsk).toHaveBeenCalledWith(prompt);
  });
});
