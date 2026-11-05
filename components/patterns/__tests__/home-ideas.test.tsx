/**
 * Home's ideas, drawn: nothing where there is nothing, a decision that reaches its handler and
 * holds both buttons while it is out, and Ask Goose's field whatever the Pond offers.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { InkButton } from '@jarida/ink/native';

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
    agent: null,
    deciding: null,
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

// Markdown sets a paragraph's runs as an array of children, so plain runs are joined back into its text.
const texts = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Text).flatMap((t) => {
    const children: unknown = t.props.children;
    if (typeof children === 'string') return [children];
    if (Array.isArray(children) && children.every((c) => typeof c === 'string')) return [children.join('')];
    return [];
  });

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

  it('shows every suggestion it is given, each with its own answers', async () => {
    const rows = ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({ ...ROW, id, summary: `Suggestion ${i + 1}` }));
    const tree = await render(<HomeIdeas {...props({ proposals: rows })} />);
    expect(texts(tree)).toEqual(expect.arrayContaining(rows.map((r) => r.summary)));
    expect(tree.root.findAllByType(InkButton)).toHaveLength(rows.length * 2);
  });

  it('sets a suggestion and its reason as markdown, not as the raw marks', async () => {
    const tree = await render(
      <HomeIdeas {...props({ proposals: [{ ...ROW, summary: 'Dim the **porch** light?', rationale: '- Five nights\n- After 23:00' }] })} />,
    );
    const shown = texts(tree).join(' ');
    expect(shown).toContain('porch');
    expect(shown).not.toContain('**');
    expect(shown).not.toMatch(/^- /m);
    expect(texts(tree)).toEqual(expect.arrayContaining(['Five nights', 'After 23:00']));
  });

  it('folds to the first suggestion and a count of the rest, and back, from its own header', async () => {
    const onToggleCollapsed = jest.fn();
    const rows = ['p1', 'p2', 'p3'].map((id, i) => ({ ...ROW, id, summary: `Suggestion ${i + 1}` }));
    const agent = { template: 'welcome-back', title: 'Welcome back', when: 'When you come home' };
    const folded = await render(<HomeIdeas {...props({ proposals: rows, agent, collapsed: true, onToggleCollapsed })} />);
    expect(texts(folded)).toContain('Suggestion 1');
    expect(texts(folded)).not.toContain('Suggestion 2');
    expect(texts(folded)).not.toContain(i18n.t('home.ideas.agent', { title: 'Welcome back' }));
    expect(texts(folded)).toContain(i18n.t('home.ideas.moreWaiting', { count: 3 }));
    expect(folded.root.findAllByType(InkButton)).toHaveLength(2);

    act(() => folded.root.findAllByType(GPressable).find((p) => p.props.accessibilityLabel === i18n.t('home.ideas.showName'))!.props.onPress());
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);

    const open = await render(<HomeIdeas {...props({ proposals: rows, agent, onToggleCollapsed })} />);
    expect(texts(open)).toContain(i18n.t('home.ideas.hide'));
    expect(texts(open)).toContain('Suggestion 3');
    expect(open.root.findAllByType(InkButton)).toHaveLength(6);
  });

  it('keeps an agent idea that is the only thing in it when folded, and offers no fold for one thing', async () => {
    const agent = { template: 'welcome-back', title: 'Welcome back', when: 'When you come home' };
    const tree = await render(<HomeIdeas {...props({ agent, collapsed: true, onToggleCollapsed: jest.fn() })} />);
    expect(texts(tree)).toContain(i18n.t('home.ideas.agent', { title: 'Welcome back' }));
    expect(texts(tree)).not.toContain(i18n.t('home.ideas.show'));
  });

  it('offers no fold while it only says that nothing waits', async () => {
    const tree = await render(<HomeIdeas {...props({ quiet: true, onToggleCollapsed: jest.fn() })} />);
    expect(texts(tree)).not.toContain(i18n.t('home.ideas.hide'));
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
  const PROMPTS = [
    { id: 'a', prompt: 'What did power cost this week?', composed: true },
    { id: 'b', prompt: 'Who rang the bell today?', composed: true },
    { id: 'c', prompt: 'Is the porch light still on?', composed: false },
    { id: 'd', prompt: 'What is on the calendar tomorrow?', composed: true },
  ];

  const field = (tree: ReactTestRenderer) =>
    tree.root.findAllByType(GPressable).find((p) => p.props.accessibilityLabel === i18n.t('pond.askGoose'))!;
  const suggestions = (tree: ReactTestRenderer) =>
    tree.root.findAllByType(GPressable).filter((p) => p.props.accessibilityHint === i18n.t('home.ask.suggestionHint'));

  it('heads the card and offers the field', async () => {
    const tree = await render(<AskRow prompts={PROMPTS} onAsk={jest.fn()} onAskGoose={jest.fn()} />);
    expect(texts(tree)).toEqual(expect.arrayContaining([i18n.t('pond.askGoose'), i18n.t('home.askPlaceholder')]));
    expect(field(tree).props.accessibilityRole).toBe('button');
  });

  it('opens a conversation from the field', async () => {
    const onAskGoose = jest.fn();
    const tree = await render(<AskRow prompts={PROMPTS} onAsk={jest.fn()} onAskGoose={onAskGoose} />);
    act(() => field(tree).props.onPress());
    expect(onAskGoose).toHaveBeenCalled();
  });

  it('asks the question picked', async () => {
    const onAsk = jest.fn();
    const tree = await render(<AskRow prompts={PROMPTS} onAsk={onAsk} onAskGoose={jest.fn()} />);
    act(() => suggestions(tree)[1].props.onPress());
    expect(onAsk).toHaveBeenCalledWith(PROMPTS[1]);
  });

  it('shows at most three questions, each held to two lines', async () => {
    const tree = await render(<AskRow prompts={PROMPTS} onAsk={jest.fn()} onAskGoose={jest.fn()} />);
    const rows = suggestions(tree);
    expect(rows.map((r) => r.props.accessibilityLabel)).toEqual(PROMPTS.slice(0, 3).map((p) => p.prompt));
    expect(texts(tree)).not.toContain(PROMPTS[3].prompt);
    expect(tree.root.findAllByType(Text).filter((t) => t.props.children === PROMPTS[0].prompt)[0].props.numberOfLines).toBe(2);
  });

  it('leaves out "Try asking" when the Pond offers no question', async () => {
    const tree = await render(<AskRow prompts={[]} onAsk={jest.fn()} onAskGoose={jest.fn()} />);
    expect(texts(tree)).not.toContain(i18n.t('home.ask.tryAsking'));
    expect(suggestions(tree)).toHaveLength(0);
    expect(field(tree)).toBeDefined();
  });
});
