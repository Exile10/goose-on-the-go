import { decodeEntities, htmlAsText, isMapLink, markdownToPlain, parseReply, webLink, type Tokens } from '../markdown';

describe('parseReply', () => {
  it('reads a fence still being streamed as code to the end, not as prose', () => {
    const tokens = parseReply('Here:\n\n```ts\nconst a = 1;\nconst b');
    const code = tokens.find((t) => t.type === 'code') as Tokens.Code;
    expect(code.lang).toBe('ts');
    expect(code.text).toBe('const a = 1;\nconst b');
  });

  it('keeps a single newline inside a paragraph, which is how the model breaks a line', () => {
    const [paragraph] = parseReply('Line one\nline two') as Tokens.Paragraph[];
    expect(paragraph.tokens.map((t) => ('text' in t ? t.text : '')).join('')).toBe('Line one\nline two');
  });
});

describe('webLink', () => {
  it.each(['https://example.com/a?b=1', 'http://pond.local:4000', ' https://example.com '])('opens %s', (href) => {
    expect(webLink(href)).toBe(href.trim());
  });

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'intent://x', 'file:///etc/hosts', '/relative', '', undefined])(
    'refuses %s',
    (href) => {
      expect(webLink(href)).toBeNull();
    },
  );
});

describe('decodeEntities', () => {
  it('decodes the named entities marked leaves for a browser', () => {
    expect(decodeEntities('Tom &amp; Jerry &lt;3 &quot;hi&quot;')).toBe('Tom & Jerry <3 "hi"');
  });

  it('leaves anything else alone', () => {
    expect(decodeEntities('&copy; & &amp')).toBe('&copy; & &amp');
  });
});

describe('isMapLink', () => {
  it.each([
    'https://www.openstreetmap.org/search?query=Fort%20Jesus',
    'https://osm.org/go/xyz',
    'https://maps.apple.com/?q=Mombasa',
    'https://www.google.com/maps/search/Mombasa',
  ])('hands %s to the maps app', (url) => {
    expect(isMapLink(url)).toBe(true);
  });

  it.each(['https://openstreetmap.org.evil.test/x', 'https://www.google.com/search?q=maps', 'https://user@openstreetmap.org.x.test', 'geo:0,0'])(
    'keeps %s in the in-app browser',
    (url) => {
      expect(isMapLink(url)).toBe(false);
    },
  );
});

describe('htmlAsText', () => {
  it('keeps HTML as its own text, and only a line break as a break', () => {
    expect(htmlAsText('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
    expect(htmlAsText('<br/>')).toBe('\n');
  });
});

describe('markdownToPlain', () => {
  it('takes the emphasis out of a schedule answer and keeps its lines', () => {
    const brief = '**Weather**\nThe current weather in Nairobi is *overcast*.\n\n**Calendar**\nNothing today.';
    expect(markdownToPlain(brief)).toBe(
      'Weather\nThe current weather in Nairobi is overcast.\nCalendar\nNothing today.',
    );
  });

  it('keeps a list numbered and bulleted, without its asterisks', () => {
    const results = 'Arsenal played two matches:\n1. **Sunday, November 1:** won 1-0\n2. **Wednesday:** won 2-1\n\n- one\n- two';
    expect(markdownToPlain(results)).toBe(
      'Arsenal played two matches:\n1. Sunday, November 1: won 1-0\n2. Wednesday: won 2-1\n• one\n• two',
    );
  });

  it('keeps a heading and a link as their words and leaves plain text alone', () => {
    expect(markdownToPlain('## Top news\nRead [the story](https://example.com) &amp; more')).toBe(
      'Top news\nRead the story & more',
    );
    expect(markdownToPlain('Notices from your Pond arrive here straight away.')).toBe(
      'Notices from your Pond arrive here straight away.',
    );
  });
});
