/**
 * The cards a conversation was drawn with, kept on the phone: by conversation
 * and by call, bounded, and gone with the conversation.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  MAX_CARD_CHARS,
  MAX_CONVERSATIONS,
  cardsFor,
  forgetAllCards,
  forgetCalls,
  forgetCards,
  rememberCard,
} from '@/services/card-cache';

const weather = { type: 'weather', data: { location: 'Nairobi', temperature: 25.9 } };
const clock = { type: 'time', data: { time: '13:18' } };
const key = (session: string) => `@goose/tool-cards/${session}`;

async function stored(session: string) {
  const raw = await AsyncStorage.getItem(key(session));
  return raw ? (JSON.parse(raw) as { at: number; cards: Record<string, unknown> }) : null;
}

beforeEach(async () => {
  await forgetAllCards();
  await AsyncStorage.clear();
});

describe('card-cache', () => {
  it('keeps a card against its conversation and its call, and writes it down', async () => {
    await rememberCard('s1', 'c1', weather);
    expect(await cardsFor('s1')).toEqual({ c1: weather });
    expect(await cardsFor('s2')).toEqual({});
    expect((await stored('s1'))?.cards).toEqual({ c1: weather });
  });

  it('keeps every card of a turn, even when they land together', async () => {
    // Not awaited in between: a turn's results arrive faster than storage writes.
    await Promise.all([rememberCard('s1', 'c1', weather), rememberCard('s1', 'c2', clock)]);
    expect((await stored('s1'))?.cards).toEqual({ c1: weather, c2: clock });
  });

  it('reads back what an earlier launch wrote', async () => {
    await AsyncStorage.setItem(key('old'), JSON.stringify({ at: 1, cards: { c9: clock } }));
    expect(await cardsFor('old')).toEqual({ c9: clock });
  });

  it('treats an unreadable record as nothing kept', async () => {
    await AsyncStorage.setItem(key('bad'), '{not json');
    expect(await cardsFor('bad')).toEqual({});
  });

  it('does not keep a card too large to be worth it', async () => {
    await rememberCard('s1', 'big', { type: 'wolfram', data: { text: 'x'.repeat(MAX_CARD_CHARS) } });
    expect(await cardsFor('s1')).toEqual({});
    expect(await stored('s1')).toBeNull();
  });

  it('forgets a conversation that is gone, and only that one', async () => {
    await rememberCard('s1', 'c1', weather);
    await rememberCard('s2', 'c2', clock);
    await forgetCards(['s1']);
    expect(await cardsFor('s1')).toEqual({});
    expect(await stored('s1')).toBeNull();
    expect(await cardsFor('s2')).toEqual({ c2: clock });
  });

  it('forgets single calls, from storage and from this launch, and keeps the rest', async () => {
    const search = { type: 'search', data: { query: 'q', results: [{ title: 'T', url: 'https://a.example/' }] } };
    await rememberCard('s1', 'c1', search);
    await rememberCard('s1', 'c2', weather);
    await rememberCard('s2', 'c1', clock);
    await forgetCalls('s1', ['c1']);
    expect(await cardsFor('s1')).toEqual({ c2: weather });
    expect((await stored('s1'))?.cards).toEqual({ c2: weather });
    expect(await cardsFor('s2')).toEqual({ c1: clock });
  });

  it('writes nothing when there is nothing to forget', async () => {
    await rememberCard('s1', 'c2', weather);
    const before = await stored('s1');
    await forgetCalls('s1', []);
    await forgetCalls('s1', ['absent']);
    await forgetCalls('never-kept', ['c1']);
    expect(await stored('s1')).toEqual(before);
    expect(await stored('never-kept')).toBeNull();
  });

  it('forgets every card on sign-out, and nothing else the app stored', async () => {
    await AsyncStorage.setItem('@goose/server-url', 'http://192.168.1.9:4000');
    await rememberCard('s1', 'c1', weather);
    await rememberCard('s2', 'c2', clock);
    await forgetAllCards();
    expect(await cardsFor('s1')).toEqual({});
    expect(await cardsFor('s2')).toEqual({});
    expect(await AsyncStorage.getAllKeys()).toEqual(['@goose/server-url']);
  });

  it('drops the conversation least recently added to once it holds too many', async () => {
    let now = 1_000;
    const time = jest.spyOn(Date, 'now').mockImplementation(() => ++now);
    try {
      for (let i = 0; i <= MAX_CONVERSATIONS; i += 1) await rememberCard(`s${i}`, 'c', clock);
    } finally {
      time.mockRestore();
    }
    const kept = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('@goose/tool-cards/'));
    expect(kept).toHaveLength(MAX_CONVERSATIONS);
    expect(kept).not.toContain(key('s0'));
    expect(kept).toContain(key(`s${MAX_CONVERSATIONS}`));
    expect(await cardsFor('s0')).toEqual({});
  });

  it('keeps writing after a write fails', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await rememberCard('s1', 'c1', weather);
    expect(await stored('s1')).toBeNull();
    await rememberCard('s2', 'c2', clock);
    expect((await stored('s2'))?.cards).toEqual({ c2: clock });
  });
});
