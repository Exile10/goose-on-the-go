/**
 * A collapsed idea card says what kind it is, the idea, why and from where, and the when, where,
 * cost and effort it has; Do it wears the action's label, and Go deeper is offered once on every card.
 */
import '@/services/i18n';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { InkProvider } from '@jarida/ink/native';

import { readIdeaCard, type IdeaCard } from '@/models/idea-cards';
import { IdeaCardView } from '../idea-cards';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('@/services/haptics', () => ({ selectionTick: jest.fn().mockResolvedValue(undefined), confirm: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));

const card = readIdeaCard({
  id: 'c1',
  kind: 'do',
  title: 'Walk the Karura waterfall trail',
  why: { text: 'You said you want more time outdoors', source: { kind: 'memory', label: 'More time outside' } },
  when: 'Saturday 2 pm',
  where: 'Karura Forest',
  cost: 'KSh 600 entry',
  effort: '2 hours',
  action: { kind: 'reminder', label: 'Remind me Saturday' },
  sources: [{ kind: 'web', title: 'Karura Forest entry fees', url: 'https://karurafriends.org/fees' }],
  notes: { found: 'Entry is KSh 600.', next: '', caveats: '' },
  state: 'new',
})!;

function words(node: ReactTestInstance): string {
  const out: string[] = [];
  const walk = (n: ReactTestInstance | string) => {
    if (typeof n === 'string') out.push(n);
    else n.children.forEach(walk);
  };
  walk(node);
  return out.join(' ');
}

function render(shown: IdeaCard, onDo = jest.fn()) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <InkProvider scheme="light">
        <IdeaCardView card={shown} busy={null} onDo={onDo} onDeeper={jest.fn()} onSave={jest.fn()} onNotThis={jest.fn()} onOpen={jest.fn()} />
      </InkProvider>,
    );
  });
  return tree;
}

describe('a collapsed idea card', () => {
  it('shows the kind, title, why with its source, and the structured fields', () => {
    const tree = render(card);
    const shown = words(tree.root);
    for (const part of ['Something to do', 'Walk the Karura waterfall trail', 'You said you want more time outdoors', 'From what you said: More time outside', 'Saturday 2 pm, Karura Forest', 'KSh 600 entry, 2 hours']) {
      expect(shown).toContain(part);
    }
    // The notes wait for the card to be opened.
    expect(shown).not.toContain('Entry is KSh 600.');
    act(() => tree.unmount());
  });

  it('labels Do it with the action, and offers Go deeper, Save and Not this', () => {
    const onDo = jest.fn();
    const tree = render(card, onDo);
    const shown = words(tree.root);
    expect(shown).toContain('Remind me Saturday');
    expect(shown).toContain('Save');
    expect(shown).toContain('Not this');
    expect(shown).toContain('Go deeper');
    act(() => tree.unmount());
  });

  it('offers Go deeper once for a go-deeper action, and draws no field it lacks', () => {
    const deeper: IdeaCard = { ...card, when: null, where: null, cost: null, effort: null, action: { kind: 'go_deeper', label: '', prompt: null, text: null, due: null, url: null } };
    const tree = render(deeper);
    const shown = words(tree.root);
    expect(shown.split('Go deeper').length - 1).toBe(1);
    expect(shown).not.toContain('Karura Forest,');
    expect(shown).not.toContain('KSh 600 entry');
    act(() => tree.unmount());
  });
});
