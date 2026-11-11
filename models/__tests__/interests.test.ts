/**
 * Interests and the interview that builds them, read defensively: an unknown category is "other",
 * an unknown news choice is "off" so nothing feeds the news by accident, and an unknown interview
 * status offers a new round rather than waiting on a question.
 */

import {
  initialOf,
  inMemberOrder,
  interestWrite,
  interviewProgress,
  openQuestion,
  readInterest,
  readInterestInterview,
  readInterests,
  readPortrait,
  sortInterests,
} from '@/models/interests';

const wire = {
  id: 'i-1',
  topic: 'Formula 1',
  category: 'sport',
  facets: ['Ferrari', ' ', 'race-day strategy', 4],
  depth: 'devoted',
  news: 'both',
  avoid: false,
  origin: 'interview',
  evidence: 3,
  confirmed: true,
  picture: '/api/v1/report-images/f1',
  updated_at: '2026-11-01T08:00:00Z',
};

describe('reading an interest', () => {
  it('keeps every field, and drops facets that are not words', () => {
    expect(readInterest(wire)).toEqual({
      id: 'i-1',
      topic: 'Formula 1',
      category: 'sport',
      facets: ['Ferrari', 'race-day strategy'],
      depth: 'devoted',
      news: 'both',
      avoid: false,
      origin: 'interview',
      evidence: 3,
      confirmed: true,
      picture: '/api/v1/report-images/f1',
      updatedAt: '2026-11-01T08:00:00Z',
    });
  });

  it('reads unknown enums as the safest values and missing fields as their defaults', () => {
    expect(readInterest({ id: 'i-2', topic: 'Origami', category: 'crafts', depth: 'obsessed', news: 'hourly' })).toMatchObject({
      category: 'other',
      depth: 'curious',
      news: 'off',
      avoid: false,
      confirmed: false,
      evidence: 0,
      facets: [],
      picture: null,
      updatedAt: null,
    });
  });

  it('keeps no picture from another host, and no interest without a topic', () => {
    expect(readInterest({ ...wire, picture: 'https://example.com/f1.jpg' })?.picture).toBeNull();
    expect(readInterest({ id: 'x', topic: '  ' })).toBeNull();
    expect(readInterests({ interests: [wire, { id: 'y' }, 'nonsense'] })).toHaveLength(1);
  });
});

describe('what the phone offers', () => {
  const rows = [
    readInterest({ ...wire, id: 'a', topic: 'A', confirmed: true }),
    readInterest({ ...wire, id: 'b', topic: 'B', confirmed: false, evidence: 1 }),
    readInterest({ ...wire, id: 'c', topic: 'C', confirmed: false, evidence: 4 }),
    readInterest({ ...wire, id: 'd', topic: 'D', confirmed: false, evidence: 2 }),
    readInterest({ ...wire, id: 'e', topic: 'E', avoid: true }),
  ].filter((i) => i !== null);

  it('offers guesses seen at least twice, best first, and keeps avoided topics apart', () => {
    const groups = sortInterests(rows);
    expect(groups.confirmed.map((i) => i.id)).toEqual(['a']);
    expect(groups.guesses.map((i) => i.id)).toEqual(['c', 'd']);
    expect(groups.avoided.map((i) => i.id)).toEqual(['e']);
  });

  it('puts interests in the member’s order, with new ones after in the Pond’s', () => {
    expect(inMemberOrder([{ id: 'x' }, { id: 'y' }, { id: 'z' }], ['z', 'x']).map((i) => i.id)).toEqual(['z', 'x', 'y']);
  });

  it('writes only the fields changed, trimmed', () => {
    expect(interestWrite({ topic: ' F1 ', facets: [' Ferrari ', ''] })).toEqual({ topic: 'F1', facets: ['Ferrari'] });
    expect(interestWrite({})).toEqual({});
  });

  it('draws a picture-less interest with its first letter', () => {
    expect(initialOf('the Boys')).toBe('T');
    expect(initialOf('  ')).toBe('?');
  });
});

describe('the interview', () => {
  const asking = {
    status: 'asking',
    turns: [
      { id: 't1', role: 'goose', text: 'What do you do on an evening off?', choices: ['Games', 'Music'], multi: true, allow_free: true, at: '2026-11-09T08:00:00Z' },
    ],
    draft: [],
    asked: 1,
    planned: 8,
  };

  it('reads the open question and its choices', () => {
    const interview = readInterestInterview(asking);
    expect(openQuestion(interview)).toMatchObject({ role: 'goose', choices: ['Games', 'Music'], multi: true, allowFree: true });
    expect(interviewProgress(interview)).toEqual({ asked: 1, planned: 8 });
  });

  it('has no open question while the Pond is writing one, or once the member has answered', () => {
    expect(openQuestion(readInterestInterview({ ...asking, status: 'thinking' }))).toBeNull();
    const answered = readInterestInterview({ ...asking, turns: [...asking.turns, { id: 't2', role: 'you', text: 'Games' }] });
    expect(openQuestion(answered)).toBeNull();
  });

  it('reads an unknown status as done, so the phone offers a new round', () => {
    expect(readInterestInterview({ status: 'paused_by_admin' }).status).toBe('done');
    expect(readInterestInterview(null)).toEqual({ status: 'done', turns: [], draft: [], asked: 0, planned: 0 });
  });

  it('keeps the drafted interests for review, and drops a turn with no words', () => {
    const review = readInterestInterview({ status: 'review', turns: [{ role: 'goose', text: '' }], draft: [wire] });
    expect(review.turns).toEqual([]);
    expect(review.draft.map((d) => d.topic)).toEqual(['Formula 1']);
  });
});

describe('the portrait', () => {
  it('is null before the Pond has written one', () => {
    expect(readPortrait({})).toBeNull();
    expect(readPortrait({ summary: 'Jerry builds Goose.', into: ['AI'], working_on: ['A talk'] })).toMatchObject({
      summary: 'Jerry builds Goose.',
      workingOn: ['A talk'],
      likes: [],
    });
  });
});
