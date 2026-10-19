/**
 * The matcher both the conversation wall and the Settings search use. Pinned here once, so the
 * two screens cannot drift into answering the same query differently.
 */

import { fold, isBlankQuery, matchesQuery } from '@/utils/search';

describe('matchesQuery', () => {
  const card = ['Devil May Cry order', 'Dante’s Awakening comes first.'];

  it('finds words in any order, across every field', () => {
    expect(matchesQuery(card, 'cry devil')).toBe(true);
    expect(matchesQuery(card, 'devil awakening')).toBe(true);
    expect(matchesQuery(card, 'devil trigger')).toBe(false);
  });

  it('ignores case, accents and stray whitespace', () => {
    expect(fold('Café')).toBe('cafe');
    expect(fold('ÉLAN')).toBe('elan');
    expect(matchesQuery(['Café opening hours', null], '  CAFE  ')).toBe(true);
    expect(matchesQuery(['Cafe opening hours'], 'café')).toBe(true);
  });

  it('lets an empty query through, and survives fields with nothing in them', () => {
    expect(matchesQuery(card, '   ')).toBe(true);
    expect(matchesQuery([null, undefined], 'anything')).toBe(false);
  });
});

describe('isBlankQuery', () => {
  it('treats whitespace as no query at all', () => {
    expect(isBlankQuery('')).toBe(true);
    expect(isBlankQuery(' \t ')).toBe(true);
    expect(isBlankQuery(' a ')).toBe(false);
  });
});
