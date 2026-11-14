// The readers for what the Pond added in week 46: the profile, the one interview, Goose's notes,
// screenshots, cards sent to chat, and the idea card's new fields.

import { factCount, readAbout, readArchived } from '@/models/about';
import { cardFromParams, cardParams, readCard, readCardKinds } from '@/models/cards';
import { readGooseNotes } from '@/models/goose-notes';
import { readHub } from '@/models/hub';
import { readIdea } from '@/models/ideas';
import { openQuestion, readKept, readMemberInterview } from '@/models/member-interview';
import { readScreenshots, roomToSend } from '@/models/screenshots';

describe('the hub', () => {
  it('reads the new parts and the card kinds, and an older Pond serves none of them', () => {
    const hub = readHub({ version: 1, about: true, interview: true, screenshots: true, cards: ['idea', 'watch', 'mystery'] });
    expect(hub).toMatchObject({ about: true, interview: true, screenshots: true, cards: ['idea', 'watch'] });
    expect(readHub({ version: 1, ideas: true })).toMatchObject({ about: false, interview: false, screenshots: false, cards: [] });
  });
});

describe('an idea card', () => {
  const wire = { id: 'i1', title: 'Lentil dal', pitch: 'Red lentils and spinach.', state: 'new' };

  it('keeps its kind, line, facts and notes', () => {
    const idea = readIdea({
      ...wire,
      kind: 'recipe',
      kind_label: 'Recipe',
      hook: 'Dinner in 35 minutes.',
      facts: [{ label: 'Serves', value: '4' }, { label: '', value: 'x' }],
      notes: 'Soak the lentils.',
      grounded_in: [{ kind: 'screenshot', label: 'Saved a recipe for dal' }],
    });
    expect(idea).toMatchObject({ kind: 'recipe', kindLabel: 'Recipe', hook: 'Dinner in 35 minutes.', notes: 'Soak the lentils.' });
    expect(idea?.facts).toEqual([{ label: 'Serves', value: '4' }]);
    expect(idea?.groundedIn[0].kind).toBe('screenshot');
  });

  it('from an older Pond shows its pitch as the line and reads as an interest', () => {
    expect(readIdea(wire)).toMatchObject({ kind: 'interest', kindLabel: '', hook: 'Red lentils and spinach.', facts: [], notes: '' });
    expect(readIdea({ ...wire, kind: 'chore' })?.kind).toBe('interest');
  });
});

describe('cards sent to chat', () => {
  it('reads a card and carries one through route params', () => {
    expect(readCard({ kind: 'Recipe', title: 'Lentil dal', content: 'Serves: 4', notes: 'Soak.' })).toEqual({ kind: 'Recipe', title: 'Lentil dal', content: 'Serves: 4', notes: 'Soak.' });
    expect(readCard({ kind: 'Recipe' })).toBeNull();
    const params = cardParams({ kind: 'idea', id: 'i1', title: 'Lentil dal' });
    expect(cardFromParams(params)).toEqual({ kind: 'idea', id: 'i1', title: 'Lentil dal' });
    expect(cardFromParams({ card_kind: 'secret', card_id: 'i1' })).toBeNull();
    expect(cardFromParams({ card_kind: 'idea' })).toBeNull();
    expect(readCardKinds('idea')).toEqual([]);
  });
});

describe('the profile', () => {
  const wire = {
    headings: [
      { segment: 'food_health', heading: 'Food and health', facts: [{ id: 'f1', content: 'Jerry is vegetarian.', about: 'diet', sensitive: false, shared: false, created_at: '2026-11-12T10:00:00Z', expires_at: null }, { id: '', content: 'x' }] },
      { segment: 'other', heading: 'Other', facts: [] },
    ],
    to_file: 3,
    words: [{ about: 'diet', heading: 'Food and health', one_at_a_time: true }, { heading: 'x' }],
  };

  it('keeps headings that hold a fact, and the words a picker offers', () => {
    const profile = readAbout(wire);
    expect(profile.headings).toHaveLength(1);
    expect(profile.headings[0].facts[0]).toMatchObject({ id: 'f1', about: 'diet', shared: false });
    expect(profile.toFile).toBe(3);
    expect(profile.words).toEqual([{ about: 'diet', heading: 'Food and health', oneAtATime: true }]);
    expect(factCount(profile)).toBe(1);
    expect(readAbout('<html>')).toEqual({ headings: [], toFile: 0, words: [] });
  });

  it('reads what was set aside with its reason', () => {
    expect(readArchived({ facts: [{ id: 'a1', content: 'Jerry asked about the weather.', why: 'it was a question' }] })[0]).toMatchObject({ id: 'a1', why: 'it was a question' });
  });
});

describe('the one interview', () => {
  it('reads the open question, progress and the draft', () => {
    const asking = readMemberInterview({
      status: 'asking',
      heading: 'You',
      progress: { done: 0, total: 8 },
      sections: [{ id: 'you', heading: 'You' }],
      turns: [{ id: 't1', role: 'goose', text: 'What do you do most days?', choices: ['Employed', 'Retired'], multi: false, allow_free: true }],
    });
    expect(openQuestion(asking)?.choices).toEqual(['Employed', 'Retired']);
    expect(asking.progress).toEqual({ done: 0, total: 8 });

    const review = readMemberInterview({
      status: 'review',
      turns: [],
      facts: [{ id: 'f1', about: 'work', content: 'Jerry is retired.' }, { id: 'f2' }],
      interests: [{ id: 'd1', topic: 'Arsenal', category: 'sport' }],
      news: 'digest',
    });
    expect(review.facts).toEqual([{ id: 'f1', about: 'work', content: 'Jerry is retired.' }]);
    expect(review.interests[0].topic).toBe('Arsenal');
    expect(review.news).toBe('digest');
    expect(openQuestion(review)).toBeNull();
    expect(readMemberInterview({ status: 'napping' }).status).toBe('done');
    expect(readKept({ facts: 5, interests: 1, news: true })).toEqual({ facts: 5, interests: 1, news: true });
  });
});

describe("Goose's notes and screenshots", () => {
  it('reads lessons and follow-ups apart', () => {
    const notes = readGooseNotes({ lessons: [{ id: 'n1', text: 'Jerry likes short answers.', shared: false }], notes: [{ id: '', text: 'x' }] });
    expect(notes.lessons).toHaveLength(1);
    expect(notes.notes).toHaveLength(0);
  });

  it('reads the choice, the queue and the lines kept', () => {
    const shots = readScreenshots({ enabled: true, available: true, pending: 2, max_pending: 6, notes: [{ id: 's1', note: 'Looking at the Ngong Hills trail', used_at: null }] });
    expect(shots).toMatchObject({ enabled: true, available: true, pending: 2 });
    expect(roomToSend(shots)).toBe(4);
    expect(readScreenshots(null)).toMatchObject({ enabled: false, available: false, notes: [] });
  });
});
