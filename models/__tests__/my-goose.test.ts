/**
 * My Goose's arithmetic and its opening sentence: what a household's own data turns into before
 * any screen draws it.
 */

import i18n from '@/services/i18n';
import type { Schedule, ScheduleRun } from '@/services/types';
import { briefFrom, cartsFrom, formatPrice, gooseClauses, readPrice, watchesWithHits, type GooseFacts } from '@/models/my-goose';
import type { SavedItem, WebWatch } from '@/models/web-watches';

const listing = (id: string, price: string | undefined, extra: Partial<SavedItem> = {}): SavedItem => ({
  id,
  kind: 'listing',
  title: `Toyota Fielder ${id}`,
  body: '',
  collection: 'Fielders under KSh 1.2M',
  shared: false,
  mine: true,
  sources: [],
  ingredients: [],
  steps: [],
  photos: [],
  price,
  updatedAt: `2026-11-0${id}T10:00:00Z`,
  ...extra,
});

const watch = (id: string, matchingCount: number, extra: Partial<WebWatch> = {}): WebWatch => ({
  id,
  title: `Watch ${id}`,
  address: 'https://jiji.co.ke',
  lookingFor: 'Fielder',
  filters: {},
  filtersWords: '',
  intervalHours: 6,
  paused: false,
  itemsCount: 20,
  matchingCount,
  failures: 0,
  lastCheckedAt: null,
  nextCheckAt: null,
  ...extra,
});

describe('a price the Pond wrote as words', () => {
  it('reads the amount and the currency it named', () => {
    expect(readPrice({ price: 'KSh 1,190,000' })).toEqual({ amount: 1190000, currency: 'KSh' });
    expect(readPrice({ price: '24.50', currency: 'USD' })).toEqual({ amount: 24.5, currency: 'USD' });
  });

  it('has no price where the words carry no number', () => {
    expect(readPrice({ price: 'Ask the seller' })).toBeNull();
    expect(readPrice({})).toBeNull();
  });

  it('writes it back with its currency', () => {
    expect(formatPrice({ amount: 1050000, currency: 'KSh' }, 'en-US')).toBe('KSh 1,050,000');
  });
});

describe('a cart of kept listings', () => {
  it('ranges from the lowest price to the highest and marks the lowest, cheapest first', () => {
    const [cart] = cartsFrom([listing('1', 'KSh 1,190,000'), listing('2', 'KSh 1,050,000'), listing('3', 'KSh 1,200,000')]);
    expect(cart.low).toEqual({ amount: 1050000, currency: 'KSh' });
    expect(cart.high).toEqual({ amount: 1200000, currency: 'KSh' });
    expect(cart.lines.map((l) => l.item.id)).toEqual(['2', '1', '3']);
    expect(cart.lines.filter((l) => l.cheapest).map((l) => l.item.id)).toEqual(['2']);
  });

  it('compares only prices in the commonest currency, and puts the unpriced last', () => {
    const [cart] = cartsFrom([
      listing('1', 'KSh 900,000'),
      listing('2', 'USD 5,000'),
      listing('3', undefined),
      listing('4', 'KSh 950,000'),
    ]);
    expect(cart.low?.currency).toBe('KSh');
    expect(cart.lines.find((l) => l.item.id === '2')?.cheapest).toBe(false);
    expect(cart.lines.at(-1)?.item.id).toBe('3');
  });

  it('marks no lowest price with nothing to compare it with', () => {
    const [cart] = cartsFrom([listing('1', 'KSh 900,000')]);
    expect(cart.lines[0].cheapest).toBe(false);
    expect(cart.high).toBeNull();
  });

  it('keeps a cart per collection, most recently kept first, and only listings', () => {
    const carts = cartsFrom([
      listing('1', 'KSh 1', { collection: 'Cars' }),
      listing('3', 'KSh 2', { collection: 'Sofas' }),
      listing('2', 'KSh 3', { collection: null }),
      { ...listing('4', undefined), kind: 'recipe' },
    ]);
    expect(carts.map((c) => c.name)).toEqual(['Sofas', null, 'Cars']);
  });
});

describe('a brief', () => {
  const schedule = {
    id: 's1',
    label: 'Morning news ',
    kind: { type: 'agent_prompt', prompt: 'Top news' },
  } as unknown as Schedule;
  const run = (id: string, at: string, status: ScheduleRun['status'] = 'completed', result: string | null = `News ${id}`) =>
    ({ id, schedule_id: 's1', status, result, error: null, started_at: at, finished_at: at, duration_ms: 1 }) as ScheduleRun;

  it('is the latest answered run, with the others as earlier', () => {
    const brief = briefFrom(schedule, [run('a', '2026-11-07T07:00:00Z'), run('b', '2026-11-09T07:00:00Z'), run('c', '2026-11-08T07:00:00Z', 'failed')]);
    expect(brief).toMatchObject({ name: 'Morning news', text: 'News b', at: '2026-11-09T07:00:00Z' });
    expect(brief?.earlier.map((e) => e.id)).toEqual(['a']);
  });

  it('is nothing until a run has answered, or for a schedule that asks no question', () => {
    expect(briefFrom(schedule, [run('a', '2026-11-09T07:00:00Z', 'completed', '  ')])).toBeNull();
    expect(briefFrom({ ...schedule, kind: { type: 'routine' } } as unknown as Schedule, [run('a', '2026-11-09T07:00:00Z')])).toBeNull();
  });
});

describe('the sentence My Goose opens with', () => {
  const none: GooseFacts = { offers: 0, watchHits: [], brief: null, reminders: 0, cart: null, ideas: 0 };
  const say = (facts: Partial<GooseFacts>) => gooseClauses({ ...none, ...facts }).map((c) => i18n.t(c.key as never, c.params));

  it('says nothing when nothing is held, so the screen can say so itself', () => {
    expect(gooseClauses(none)).toEqual([]);
  });

  it('puts a decision first, then what changed, then what is ready, and stops at three', () => {
    const clauses = gooseClauses({
      ...none,
      ideas: 4,
      cart: { count: 4, low: 'KSh 1,050,000' },
      brief: { name: 'Morning news', at: '' },
      watchHits: [watch('w', 3)],
      offers: 2,
    });
    expect(clauses.map((c) => c.shelf)).toEqual(['offers', 'watching', 'news']);
  });

  it('reads as the household would say it', () => {
    expect(say({ offers: 1 })).toEqual(['1 suggestion is waiting on your yes.']);
    expect(say({ watchHits: [watch('a', 3, { title: 'Fielder on Jiji' })] })).toEqual(['Your Fielder on Jiji watch has 3 matches.']);
    expect(say({ watchHits: [watch('a', 3), watch('b', 2)] })).toEqual(['5 listings match across 2 watches.']);
    expect(say({ cart: { count: 4, low: 'KSh 1,050,000' } })).toEqual(['You kept 4 listings, from KSh 1,050,000.']);
  });

  it('counts only watches with matches, most first, and none that are paused', () => {
    expect(watchesWithHits([watch('a', 1), watch('b', 0), watch('c', 5), watch('d', 9, { paused: true })]).map((w) => w.id)).toEqual(['c', 'a']);
  });
});
