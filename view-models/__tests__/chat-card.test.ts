// A card sent to chat rides the turn by kind and id only: the Pond reads the card itself, so the
// phone never sends its words.

import { readWebWatch } from '@/models/web-watches';
import { streamBody } from '@/view-models/use-chat';

describe('a turn sent with a card', () => {
  it('names the card by kind and id, and nothing else of it', () => {
    const body = streamBody('Halve this for two.', [], { card: { kind: 'idea', id: 'i1' } }, 's1');
    expect(body.card).toEqual({ kind: 'idea', id: 'i1' });
    expect(body.message).toBe('Halve this for two.');
    expect(body.session_id).toBe('s1');
  });

  it('sends no card field without one, so an older Pond sees the body it knows', () => {
    expect('card' in streamBody('Hello', [], {}, null)).toBe(false);
  });
});

describe('a watch with a rule', () => {
  it('reads the rule in words and how the page stood', () => {
    const watch = readWebWatch({
      id: 'w1',
      title: "Today's rates",
      filters: { tell_when: { when: 'above', phrase: 'USD/KES', value: 130 } },
      filters_words: 'when USD/KES goes above 130',
      standing: 'USD/KES is 129.4 now',
    });
    expect(watch).toMatchObject({ hasRule: true, filtersWords: 'when USD/KES goes above 130', standing: 'USD/KES is 129.4 now' });
  });

  it('a listing watch has no rule and no standing', () => {
    expect(readWebWatch({ id: 'w2', title: 'Used cars', filters: { words: ['forester'] }, filters_words: 'forester' })).toMatchObject({ hasRule: false, standing: null });
  });
});
