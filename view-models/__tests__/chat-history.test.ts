/**
 * The decisions the conversation wall makes before anything is drawn: how tall
 * a card is, what its date says, where it lands, and whether a search finds it.
 *
 * The first two are copies of pond-desktop's `ChatHistory` rules, so these
 * pin the phone to the same answers the desktop's own tests give.
 *
 * The list's sections have no desktop to agree with, so they are pinned to the
 * labels instead: both count the same calendar days. And a bulk delete is
 * pinned to how many requests it has in flight, which is the number that
 * matters to a small Pond with a rate limit.
 */

import {
  calendarDaysBetween,
  cardWeight,
  fold,
  isEmpty,
  isHistoryView,
  isRoutine,
  matchesQuery,
  passesFilter,
  placeOnWall,
  recencyKey,
  relativeWhen,
  sectionByRecency,
  settleEach,
  toCard,
  type HistorySection,
} from '@/view-models/use-chat-history';
import type { SessionSummary } from '@/services/types';

const LOCALE = 'en-US';

/** Local wall-clock times, so the day arithmetic is the device's own. */
function at(y: number, m: number, d: number, h = 12, min = 0): Date {
  return new Date(y, m - 1, d, h, min);
}

/**
 * The days the clocks change in 2026, in the US and in Europe, as [month, day].
 * Whichever zone the suite runs in, each is one calendar day long. In a zone
 * that observes the change it is also 23 or 25 hours long, which is the case
 * the rounding in `calendarDaysBetween` exists for — so run the suite once
 * with `TZ=America/New_York` or `TZ=Europe/London` after touching it.
 */
const CLOCK_CHANGES_2026: [number, number][] = [
  [3, 8],
  [3, 29],
  [10, 25],
  [11, 1],
];

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'a1',
    title: 'Devil May Cry order',
    preview: 'The chronological order of the mainline series',
    created_at: '2026-09-20T09:00:00+00:00',
    updated_at: '2026-09-22T09:00:00+00:00',
    message_count: 4,
    ...overrides,
  };
}

describe('cardWeight', () => {
  it('lets a long conversation stand as a column', () => {
    expect(cardWeight({ message_count: 20, preview: 'short' })).toBe('column');
    expect(cardWeight({ message_count: 2, preview: 'x'.repeat(160) })).toBe('column');
  });

  it('gives a middling one a card', () => {
    expect(cardWeight({ message_count: 6, preview: 'short' })).toBe('card');
    expect(cardWeight({ message_count: 1, preview: 'x'.repeat(60) })).toBe('card');
  });

  it('keeps a quick exchange a tile, including one the Pond sent nulls for', () => {
    expect(cardWeight({ message_count: 5, preview: 'x'.repeat(59) })).toBe('tile');
    expect(cardWeight({ message_count: undefined, preview: null as unknown as string })).toBe('tile');
  });
});

describe('relativeWhen', () => {
  const now = at(2026, 9, 24, 10, 0);

  it('gives a time for today', () => {
    expect(relativeWhen(at(2026, 9, 24, 9, 41).toISOString(), now, LOCALE, 'Yesterday')).toBe(
      '9:41 AM',
    );
  });

  it('says yesterday in the words it was given', () => {
    expect(relativeWhen(at(2026, 9, 23, 23, 50).toISOString(), now, LOCALE, 'Gestern')).toBe(
      'Gestern',
    );
  });

  it('counts calendar days, not 24-hour spans', () => {
    // Two minutes apart across midnight is still yesterday.
    const justBefore = at(2026, 9, 23, 23, 59).toISOString();
    expect(relativeWhen(justBefore, at(2026, 9, 24, 0, 1), LOCALE, 'Yesterday')).toBe('Yesterday');
  });

  it('names the weekday inside the last week, then falls back to a date', () => {
    expect(relativeWhen(at(2026, 9, 22).toISOString(), now, LOCALE, 'Yesterday')).toBe('Tuesday');
    expect(relativeWhen(at(2026, 9, 17).toISOString(), now, LOCALE, 'Yesterday')).toBe('Sep 17');
  });

  it('adds the year once it is not this one', () => {
    expect(relativeWhen(at(2025, 9, 17).toISOString(), now, LOCALE, 'Yesterday')).toBe(
      'Sep 17, 2025',
    );
  });

  it('reads a clock that runs ahead of the Pond as today, and garbage as nothing', () => {
    expect(relativeWhen(at(2026, 9, 25, 9, 5).toISOString(), now, LOCALE, 'Yesterday')).toBe(
      '9:05 AM',
    );
    expect(relativeWhen('not a date', now, LOCALE, 'Yesterday')).toBe('');
  });
});

describe('calendarDaysBetween', () => {
  it('counts midnights passed, not 24-hour spans', () => {
    expect(calendarDaysBetween(at(2026, 9, 24, 0, 5), at(2026, 9, 24, 23, 55))).toBe(0);
    expect(calendarDaysBetween(at(2026, 9, 23, 23, 59), at(2026, 9, 24, 0, 1))).toBe(1);
    // A clock that runs ahead of the Pond is behind it, not in the future.
    expect(calendarDaysBetween(at(2026, 9, 25, 9), at(2026, 9, 24, 9))).toBe(-1);
  });

  it('counts across the end of a month and of a year', () => {
    expect(calendarDaysBetween(at(2026, 8, 31, 22), at(2026, 9, 1, 2))).toBe(1);
    expect(calendarDaysBetween(at(2025, 12, 31, 23, 30), at(2026, 1, 1, 0, 30))).toBe(1);
    expect(calendarDaysBetween(at(2025, 12, 25), at(2026, 1, 24))).toBe(30);
  });

  it('counts a day the clocks change on as one day, however long it was', () => {
    for (const [m, d] of CLOCK_CHANGES_2026) {
      expect(calendarDaysBetween(at(2026, m, d, 0, 30), at(2026, m, d + 1, 0, 30))).toBe(1);
      // A week with the short or the long day inside it is still seven days.
      expect(calendarDaysBetween(at(2026, m, d - 1), at(2026, m, d + 6))).toBe(7);
    }
  });
});

describe('isEmpty', () => {
  it('drops only a row the Pond says holds nothing', () => {
    expect(isEmpty({ message_count: 0 })).toBe(true);
    expect(isEmpty({ message_count: 1 })).toBe(false);
  });

  it('does not read a missing count as empty, or an older Pond loses its whole wall', () => {
    expect(isEmpty({ message_count: undefined })).toBe(false);
    expect(isEmpty({})).toBe(false);
  });
});

describe('isRoutine and passesFilter', () => {
  it('knows the Pond opened a sched- session for itself', () => {
    expect(isRoutine('sched-morning-brief-1790227682')).toBe(true);
    expect(isRoutine('3f2a9c1e-5b7d-4e8a-9c0f-1a2b3c4d5e6f')).toBe(false);
    // The prefix, not the word: a person can name a session anything.
    expect(isRoutine('my-sched-notes')).toBe(false);
  });

  it('narrows to what each filter says and nothing more', () => {
    const chat = { routine: false };
    const routine = { routine: true };
    expect([passesFilter(chat, 'all'), passesFilter(routine, 'all')]).toEqual([true, true]);
    expect([passesFilter(chat, 'chats'), passesFilter(routine, 'chats')]).toEqual([true, false]);
    expect([passesFilter(chat, 'routines'), passesFilter(routine, 'routines')]).toEqual([
      false,
      true,
    ]);
  });
});

describe('matchesQuery', () => {
  const card = { title: 'Devil May Cry order', preview: 'Dante’s Awakening comes first.' };

  it('finds words in any order, across title and preview', () => {
    expect(matchesQuery(card, 'cry devil')).toBe(true);
    expect(matchesQuery(card, 'devil awakening')).toBe(true);
    expect(matchesQuery(card, 'devil trigger')).toBe(false);
  });

  it('ignores case, accents and stray whitespace', () => {
    expect(fold('Café')).toBe('cafe');
    expect(matchesQuery({ title: 'Café opening hours', preview: null }, '  CAFE  ')).toBe(true);
  });

  it('lets an empty query through, and survives a card with nothing on it', () => {
    expect(matchesQuery(card, '   ')).toBe(true);
    expect(matchesQuery({ title: null, preview: null }, 'anything')).toBe(false);
  });
});

describe('placeOnWall', () => {
  it('reads newest-first from the top: each card takes the shorter column', () => {
    // card(4) tile(3) column(5) tile(3)
    const slots = placeOnWall(['card', 'tile', 'column', 'tile']);
    expect(slots).toEqual([
      { column: 0, row: 0, span: 4 },
      { column: 1, row: 0, span: 3 },
      // Right is shorter (3 < 4), so the third card goes right, not under the first.
      { column: 1, row: 3, span: 5 },
      { column: 0, row: 4, span: 3 },
    ]);
  });

  it('breaks a tie to the left, so two equal cards sit side by side', () => {
    const slots = placeOnWall(['tile', 'tile', 'tile']);
    expect(slots.map((s) => [s.column, s.row])).toEqual([
      [0, 0],
      [1, 0],
      [0, 3],
    ]);
  });

  it('keeps one column in order for a narrow screen', () => {
    const slots = placeOnWall(['tile', 'column', 'card'], 1);
    expect(slots.map((s) => s.row)).toEqual([0, 3, 8]);
  });
});

describe('isHistoryView', () => {
  it('takes only a layout this build knows', () => {
    expect(isHistoryView('grid')).toBe(true);
    expect(isHistoryView('list')).toBe(true);
    // What an absent key reads back as, and what some other build might store.
    expect(isHistoryView(null)).toBe(false);
    expect(isHistoryView('masonry')).toBe(false);
  });
});

describe('recencyKey', () => {
  const now = at(2026, 9, 24, 10, 0);
  const key = (then: Date) => recencyKey(then.getTime(), now);

  it('files today and yesterday by calendar day', () => {
    expect(key(at(2026, 9, 24, 0, 1))).toBe('today');
    expect(key(at(2026, 9, 23, 23, 59))).toBe('yesterday');
  });

  it('keeps the week to the six days before yesterday, then holds thirty', () => {
    expect(key(at(2026, 9, 22))).toBe('week');
    expect(key(at(2026, 9, 18))).toBe('week');
    expect(key(at(2026, 9, 17))).toBe('month');
    // August 26 is 29 days back, the 25th is 30.
    expect(key(at(2026, 8, 26))).toBe('month');
    expect(key(at(2026, 8, 25))).toBe('2026-08');
  });

  it('agrees with the labels: a weekday under the week, a date from the first row past it', () => {
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    for (let back = 2; back <= 9; back += 1) {
      const then = at(2026, 9, 24 - back);
      const label = relativeWhen(then.toISOString(), now, LOCALE, 'Yesterday');
      expect([back, weekdays.includes(label)]).toEqual([back, key(then) === 'week']);
    }
  });

  it('names a calendar month with its year, padded so the keys sort', () => {
    expect(key(at(2026, 3, 2))).toBe('2026-03');
    expect(key(at(2025, 11, 30))).toBe('2025-11');
  });

  it('files a clock ahead of the Pond as today, and a time it cannot read as undated', () => {
    expect(key(at(2026, 9, 25, 9, 5))).toBe('today');
    expect(recencyKey(Number.NaN, now)).toBe('undated');
  });
});

describe('sectionByRecency', () => {
  const now = at(2026, 9, 24, 10, 0);
  const LABELS = {
    today: 'Today',
    yesterday: 'Yesterday',
    week: 'Previous 7 days',
    month: 'Previous 30 days',
    undated: 'Earlier',
  };
  const card = (id: string, then: Date | number) => ({
    id,
    updatedAt: typeof then === 'number' ? then : then.getTime(),
  });
  const shape = (sections: HistorySection<{ id: string }>[]) =>
    sections.map((s) => [s.title, s.data.map((c) => c.id)]);

  it('runs today, yesterday, the week, the month, then calendar months, newest first', () => {
    const sections = sectionByRecency(
      [
        card('a', at(2026, 9, 24, 9)),
        card('b', at(2026, 9, 24, 8)),
        card('c', at(2026, 9, 23)),
        card('d', at(2026, 9, 20)),
        card('e', at(2026, 9, 10)),
        card('f', at(2026, 8, 12)),
        card('g', at(2026, 7, 30)),
      ],
      now,
      LOCALE,
      LABELS,
    );
    expect(shape(sections)).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Previous 7 days', ['d']],
      ['Previous 30 days', ['e']],
      ['August', ['f']],
      ['July', ['g']],
    ]);
  });

  it('keys each section by its span or month, so a refresh does not remount it', () => {
    const sections = sectionByRecency(
      [card('a', at(2026, 9, 24)), card('b', at(2026, 3, 2))],
      now,
      LOCALE,
      LABELS,
    );
    expect(sections.map((s) => s.key)).toEqual(['today', '2026-03']);
  });

  it('names the year once a month is not in this one', () => {
    const january = at(2026, 1, 20);
    const sections = sectionByRecency(
      [card('a', at(2025, 12, 3)), card('b', at(2025, 11, 28)), card('c', at(2025, 1, 15))],
      january,
      LOCALE,
      LABELS,
    );
    expect(shape(sections)).toEqual([
      ['December 2025', ['a']],
      ['November 2025', ['b']],
      // The same month as now's, a year back: the year is what tells them apart.
      ['January 2025', ['c']],
    ]);
  });

  it('keeps yesterday and the last thirty days whole across the new year', () => {
    const sections = sectionByRecency(
      [card('a', at(2025, 12, 31, 23)), card('b', at(2025, 12, 20)), card('c', at(2025, 11, 30))],
      at(2026, 1, 1, 9),
      LOCALE,
      LABELS,
    );
    expect(shape(sections)).toEqual([
      ['Yesterday', ['a']],
      ['Previous 30 days', ['b']],
      ['November 2025', ['c']],
    ]);
  });

  it('files across a day the clocks change on as the labels do', () => {
    for (const [m, d] of CLOCK_CHANGES_2026) {
      const sections = sectionByRecency(
        [card('a', at(2026, m, d, 0, 30)), card('b', at(2026, m, d - 6))],
        at(2026, m, d + 1, 0, 30),
        LOCALE,
        LABELS,
      );
      // Seven calendar days back is past the week, even with a 23-hour day in it.
      expect(shape(sections)).toEqual([
        ['Yesterday', ['a']],
        ['Previous 30 days', ['b']],
      ]);
    }
  });

  it('puts the sections in order even when the conversations are not', () => {
    const sections = sectionByRecency(
      [
        card('june', at(2026, 6, 2)),
        card('unreadable', Number.NaN),
        card('morning', at(2026, 9, 24, 9)),
        card('august', at(2026, 8, 1)),
        card('dawn', at(2026, 9, 24, 6)),
      ],
      now,
      LOCALE,
      LABELS,
    );
    expect(shape(sections)).toEqual([
      // Inside a section, the order given: the Pond's, which the wall uses too.
      ['Today', ['morning', 'dawn']],
      ['August', ['august']],
      ['June', ['june']],
      ['Earlier', ['unreadable']],
    ]);
  });

  it('has nothing to say about no conversations', () => {
    expect(sectionByRecency([], now, LOCALE, LABELS)).toEqual([]);
  });
});

describe('settleEach', () => {
  /** A task that takes `delays[id]` ms and counts how many of it run at once. */
  function tracked(delays: Record<string, number>, refused: string[] = []) {
    const calls: string[] = [];
    let running = 0;
    let peak = 0;
    const task = async (id: string) => {
      calls.push(id);
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, delays[id] ?? 0));
      running -= 1;
      if (refused.includes(id)) throw new Error(`refused ${id}`);
    };
    return { task, calls, peak: () => peak };
  }

  it('keeps no more than the limit in flight, and tries each item exactly once', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const run = tracked({ a: 8, b: 1, c: 4, d: 2, e: 6, f: 1, g: 3 });
    const result = await settleEach(ids, run.task, 3);
    expect(run.peak()).toBe(3);
    expect([...run.calls].sort()).toEqual(ids);
    expect(result).toEqual({ fulfilled: ids, rejected: [] });
  });

  it('sorts the outcomes in the order the items came, not the order they finished', async () => {
    const run = tracked({ a: 9, b: 1, c: 5, d: 1 }, ['c', 'a']);
    const result = await settleEach(['a', 'b', 'c', 'd'], run.task, 2);
    expect(result).toEqual({ fulfilled: ['b', 'd'], rejected: ['a', 'c'] });
  });

  it('counts a task that throws before it awaits as refused, not as a crash', async () => {
    const task = (id: string) => {
      if (id === 'x') throw new Error('no');
      return Promise.resolve();
    };
    await expect(settleEach(['x', 'y'], task, 3)).resolves.toEqual({
      fulfilled: ['y'],
      rejected: ['x'],
    });
  });

  it('settles at once with nothing to do, and starts no more workers than items', async () => {
    const run = tracked({});
    await expect(settleEach([], run.task, 3)).resolves.toEqual({ fulfilled: [], rejected: [] });
    await settleEach(['only'], run.task, 3);
    expect(run.peak()).toBe(1);
  });
});

describe('toCard', () => {
  it('turns the Pond’s nulls into absences and keeps its order-relevant facts', () => {
    const card = toCard(
      session({
        id: 'sched-x-1',
        title: '  ' as string,
        preview: null as unknown as string,
        message_count: 21,
      }),
      at(2026, 9, 24),
      LOCALE,
      'Yesterday',
    );
    expect(card).toMatchObject({
      id: 'sched-x-1',
      title: null,
      preview: null,
      messageCount: 21,
      weight: 'column',
      routine: true,
    });
  });

  it('keeps when it last moved as a number, and an unreadable time as NaN rather than a guess', () => {
    const now = at(2026, 9, 24);
    expect(toCard(session(), now, LOCALE, 'Yesterday').updatedAt).toBe(Date.UTC(2026, 8, 22, 9));
    expect(toCard(session({ updated_at: 'soon' }), now, LOCALE, 'Yesterday').updatedAt).toBeNaN();
  });
});
