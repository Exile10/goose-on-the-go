import {
  readReportImage,
  readReportOption,
  readSavedItem,
  readWebWatch,
  readWebWatchDetail,
  siteOf,
} from '@/models/web-watches';
import { optionCard } from '@/view-models/use-report-options';
import { savedSummary } from '@/view-models/saved-words';

describe('reading watches', () => {
  it('reads a watch, and drops one without an id or title', () => {
    const watch = readWebWatch({
      id: 'w1',
      title: 'Used cars',
      address: 'https://www.cars.example/used',
      filters: { words: ['forester'], max_price: 1500000 },
      filters_words: 'forester, up to 1,500,000',
      interval_hours: 6,
      paused: false,
      items_count: 12,
      matching_count: 2,
      failures: 0,
    });
    expect(watch).toMatchObject({ id: 'w1', intervalHours: 6, matchingCount: 2, filters: { max_price: 1500000 } });
    expect(readWebWatch({ title: 'no id' })).toBeNull();
    expect(siteOf('https://www.cars.example/used?x=1')).toBe('cars.example');
  });

  it('reads a detail with its items and changes, leaving out what is malformed', () => {
    const detail = readWebWatchDetail({
      id: 'w1',
      title: 'Used cars',
      items: [{ title: 'Forester', price: '1450000', link: 'javascript:alert(1)' }, { nope: 1 }],
      changes: [{ id: 3, line: 'New: Forester, KES 1,450,000', matched: true, kind: 'new' }, { line: 7 }],
    });
    expect(detail?.items).toEqual([{ title: 'Forester', price: '1450000' }].map((i) => expect.objectContaining(i)));
    expect(detail?.items[0].link).toBeUndefined();
    expect(detail?.changes).toHaveLength(1);
    expect(detail?.changes[0]).toMatchObject({ matched: true, kind: 'new' });
  });
});

describe('reading saved cards and report extras', () => {
  it('reads a listing card and says its price line', () => {
    const card = readSavedItem({
      id: 'c1',
      kind: 'listing',
      title: '2017 Subaru Forester',
      price: '1,450,000',
      currency: 'KES',
      mileage: '98,000 km',
      shared: true,
      mine: false,
      sources: [{ title: 'Cars', url: 'https://cars.example/2' }, { url: 'file:///x' }],
    });
    expect(card).toMatchObject({ kind: 'listing', shared: true, mine: false });
    expect(card?.sources).toHaveLength(1);
    expect(savedSummary(card!)).toBe('KES 1,450,000 · 98,000 km');
    expect(readSavedItem({ id: 'c2', kind: 'mystery', title: 'x' })?.kind).toBe('note');
  });

  it('takes a report picture only from the Pond itself', () => {
    expect(readReportImage({ key: 'a', src: '/api/v1/report-images/0123456789abcdef0123456789abcdef', credit: 'CC BY-SA 4.0' })).not.toBeNull();
    expect(readReportImage({ key: 'a', src: 'https://evil.example/t.png' })).toBeNull();
    expect(readReportImage({ key: 'a', src: '/api/v1/report-images/../../secrets' })).toBeNull();
  });

  it('keeps an option as a listing card with its facts in the body', () => {
    const option = readReportOption({
      title: '2017 Subaru Forester',
      price: 'KES 1,450,000',
      link: 'https://cars.example/2',
      why: 'Lowest mileage.',
      fields: [['Mileage', '98,000 km'], ['bad']],
      sources: [{ title: 'Cars', url: 'https://cars.example/2' }],
    });
    expect(option?.fields).toEqual([['Mileage', '98,000 km']]);
    expect(optionCard(option!, 'Cars to buy')).toEqual({
      kind: 'listing',
      title: '2017 Subaru Forester',
      price: 'KES 1,450,000',
      link: 'https://cars.example/2',
      body: 'Lowest mileage.\n- Mileage: 98,000 km',
      collection: 'Cars to buy',
      sources: [{ title: 'Cars', url: 'https://cars.example/2' }],
    });
  });
});
