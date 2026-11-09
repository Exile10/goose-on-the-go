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

describe('the pages an answer cites', () => {
  const { citedLinks, mergeSources } = jest.requireActual('@/models/sources');

  it('numbers cited pages in citing order, once each, then the other pages read', () => {
    const cited = citedLinks(
      'Fort Jesus ([Wikipedia](https://en.wikipedia.org/wiki/Fort_Jesus)) is old; see [the fort](https://fort.example/) and [Wikipedia](https://en.wikipedia.org/wiki/Fort_Jesus) again, not [mail](mailto:x@y.z).',
    );
    expect(cited.map((s: { url: string }) => s.url)).toEqual(['https://en.wikipedia.org/wiki/Fort_Jesus', 'https://fort.example/']);
    const all = mergeSources(cited, [
      { title: 'Fort', url: 'https://fort.example/' },
      { title: 'Ferry', url: 'https://ferry.example/' },
    ]);
    expect(all.map((s: { url: string }) => s.url)).toEqual([
      'https://en.wikipedia.org/wiki/Fort_Jesus',
      'https://fort.example/',
      'https://ferry.example/',
    ]);
  });

  it('names a page by itself, not by its site', () => {
    const [wiki, fort] = citedLinks(
      'See [Wikipedia](https://en.wikipedia.org/wiki/Playboi_Carti) and [the fort](https://fort.example/).',
    );
    expect(wiki.title).toBe('Playboi Carti');
    expect(fort.title).toBe('the fort');
    expect(citedLinks('[Wikipedia](https://www.wikipedia.org/)')[0].title).toBe('Wikipedia');
    const [read] = mergeSources([wiki], [{ title: 'Playboi Carti - Wikipedia', url: wiki.url }]);
    expect(read.title).toBe('Playboi Carti - Wikipedia');
  });
});
