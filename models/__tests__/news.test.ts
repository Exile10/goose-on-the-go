/**
 * News read defensively: an unknown story kind is news, a picture is only ever the Pond's own, a
 * reason the Pond cannot write is kept only when the phone knows it, and settings default to off.
 */

import { agoParts, clockParts, isFresh, readDigest, readHistory, readNewsFeed, readNewsSettings, readStory, readStoryDetail, splitStories } from '@/models/news';

const story = {
  id: 's-1',
  kind: 'news',
  headline: 'MCP Dev Summit publishes its programme',
  dek: 'Two days of talks.',
  picture: '/api/v1/report-images/abc',
  source: { name: 'Summit', url: 'https://events.example.org/x' },
  interest: { id: 'i-ai', topic: 'On-device AI', category: 'tech' },
  published_at: '2026-11-09T07:00:00Z',
  written_at: '2026-11-09T07:30:00Z',
  read: true,
};

describe('a story', () => {
  it('keeps its fields', () => {
    expect(readStory(story)).toMatchObject({
      id: 's-1',
      kind: 'news',
      picture: '/api/v1/report-images/abc',
      source: { name: 'Summit', url: 'https://events.example.org/x' },
      interest: { id: 'i-ai', topic: 'On-device AI', category: 'tech' },
      read: true,
      readAt: null,
    });
  });

  it('reads an unknown kind as news, and a long read as a long read', () => {
    expect(readStory({ ...story, kind: 'podcast' })?.kind).toBe('news');
    expect(readStory({ ...story, kind: 'long_read' })?.kind).toBe('long_read');
    expect(readStory({ ...story, kind: undefined })?.kind).toBe('news');
  });

  it('keeps no picture or link from elsewhere, and names a source by its site when unnamed', () => {
    const odd = readStory({ ...story, picture: 'https://cdn.example.com/a.jpg', source: { url: 'javascript:alert(1)' } });
    expect(odd?.picture).toBeNull();
    expect(odd?.source).toEqual({ name: '', url: null });
    expect(readStory({ ...story, source: { url: 'https://www.nation.africa/a' } })?.source.name).toBe('nation.africa');
  });

  it('reads an unknown category as unknown and an unread story as unread', () => {
    const s = readStory({ ...story, interest: { id: 'x', topic: 'Y', category: 'crafts' }, read: 'yes' });
    expect(s?.interest?.category).toBeNull();
    expect(s?.read).toBe(false);
  });

  it('reads the detail’s summary, why and only sources with a web address', () => {
    const detail = readStoryDetail({ ...story, summary: '**Hello**', why_you: 'You speak there.', sources: [{ title: 'A', url: 'https://a.example' }, { title: 'B', url: 'ftp://b' }] });
    expect(detail?.whyYou).toBe('You speak there.');
    expect(detail?.sources).toEqual([{ title: 'A', url: 'https://a.example', site: 'a.example' }]);
  });
});

describe('the feed', () => {
  it('keeps a reason it knows and drops one it does not', () => {
    expect(readNewsFeed({ stories: [story], state: 'writing', blocked: 'no_interests' })).toMatchObject({ state: 'writing', blocked: 'no_interests' });
    expect(readNewsFeed({ blocked: 'web_search' }).blocked).toBe('web_search');
    expect(readNewsFeed({ blocked: 'quota' }).blocked).toBeNull();
    expect(readNewsFeed({ state: 'dreaming' })).toMatchObject({ state: 'idle', stories: [], digest: null, blocked: null });
  });

  it('sets long reads apart from the headlines', () => {
    const { news, longReads } = splitStories([readStory(story)!, readStory({ ...story, id: 's-2', kind: 'long_read' })!]);
    expect(news.map((s) => s.id)).toEqual(['s-1']);
    expect(longReads.map((s) => s.id)).toEqual(['s-2']);
  });

  it('reads the history most recent first', () => {
    const history = readHistory({ stories: [{ ...story, id: 'a', read_at: '2026-11-08T10:00:00Z' }, { ...story, id: 'b', read_at: '2026-11-09T10:00:00Z' }] });
    expect(history.map((s) => s.id)).toEqual(['b', 'a']);
  });
});

describe('the digest', () => {
  it('keeps sections with words, pictures from the Pond, and the listen path', () => {
    const digest = readDigest({
      id: 'd-1',
      title: 'Your morning',
      intro: 'Two things.',
      listen: '/api/v1/me/news/digests/d-1/listen',
      sections: [
        { interest: { id: 'i', topic: 'AI' }, heading: 'Summit', body: 'Text', pictures: [{ path: '/api/v1/report-images/a', caption: 'KICC' }, { path: 'https://x/y.jpg' }], references: [] },
        { heading: '', body: '' },
      ],
    });
    expect(digest?.sections).toHaveLength(1);
    expect(digest?.sections[0].pictures).toEqual([{ path: '/api/v1/report-images/a', caption: 'KICC', sourceUrl: null }]);
    expect(digest?.listen).toBe('/api/v1/me/news/digests/d-1/listen');
  });

  it('offers no audio from a path outside the Pond’s API', () => {
    expect(readDigest({ id: 'd', listen: 'https://elsewhere/a.wav' })?.listen).toBeNull();
  });
});

describe('settings and time', () => {
  it('defaults everything off, and a malformed time to seven', () => {
    expect(readNewsSettings({ digest_time: '25:99' })).toEqual({ digest: false, digestTime: '07:00', spokenOnSpeaker: false, tiles: false, timezone: '' });
    expect(clockParts('06:45')).toEqual({ hour: 6, minute: 45 });
  });

  it('says how long ago, and whether a story is new', () => {
    const now = new Date('2026-11-09T12:00:00Z');
    expect(agoParts('2026-11-09T11:26:00Z', now)).toEqual({ unit: 'm', value: 34 });
    expect(agoParts('2026-11-09T07:00:00Z', now)).toEqual({ unit: 'h', value: 5 });
    expect(agoParts('2026-11-07T12:00:00Z', now)).toEqual({ unit: 'd', value: 2 });
    expect(agoParts('2026-11-09T11:59:40Z', now).unit).toBe('now');
    expect(isFresh({ publishedAt: '2026-11-09T10:00:00Z', writtenAt: null }, now)).toBe(true);
    expect(isFresh({ publishedAt: '2026-11-09T08:00:00Z', writtenAt: null }, now)).toBe(false);
    expect(isFresh({ publishedAt: null, writtenAt: null }, now)).toBe(false);
  });
});
