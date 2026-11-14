import {
  decodeEntities,
  htmlAsText,
  isMapLink,
  isMath,
  markdownToPlain,
  parseReply,
  splitDisplayMath,
  webLink,
  type Token,
  type Tokens,
} from '../markdown';

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

  it('decodes the typographic ones a model writes, and numeric ones', () => {
    expect(decodeEntities('&copy; 2026 &mdash; it&rsquo;s &euro;5 &#36;5 &#x2F;usr')).toBe('© 2026 — it’s €5 $5 /usr');
  });

  it('decodes once, so an escaped entity shows as the entity it spells', () => {
    expect(decodeEntities('&amp;lt; &amp;amp;')).toBe('&lt; &amp;');
  });

  it('leaves anything else alone', () => {
    expect(decodeEntities('&bogus; & &amp &#0; &#xD800;')).toBe('&bogus; & &amp &#0; &#xD800;');
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

/** Each math token in a reply, with whether it is set on its own line. */
function maths(source: string): { text: string; display: boolean }[] {
  const out: { text: string; display: boolean }[] = [];
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (isMath(t)) out.push({ text: t.text, display: t.display });
      else if ('tokens' in t && t.tokens) walk(t.tokens);
    }
  };
  walk(parseReply(source));
  return out;
}

describe('math in a reply', () => {
  it('reads all four of the delimiters models use', () => {
    expect(maths('Inline $x^2$ and \\(a+b\\).\n\n$$\nE = mc^2\n$$\n\n\\[\n\\int_0^1 x\\,dx\n\\]')).toEqual([
      { text: 'x^2', display: false },
      { text: 'a+b', display: false },
      { text: 'E = mc^2', display: true },
      { text: '\\int_0^1 x\\,dx', display: true },
    ]);
  });

  it.each([
    'It costs $5 and $10.',
    'Between $5-$10, or $1,000.50 in all.',
    'Prices run $10$ to $20$ a night.',
    'Add $HOME/bin to $PATH.',
    'export PATH=$HOME/bin:$PATH',
    'That is US$5, not $5USD.',
    'Escaped \\$x\\$ stays as written.',
    'See \\[1\\] and \\[2\\].',
    'In code: `$x^2$` and `\\(y\\)`.',
  ])('leaves money, paths and escapes as text: %s', (source) => {
    expect(maths(source)).toEqual([]);
  });

  it('keeps the dollars, slashes and backslashes of a reply that holds no math', () => {
    expect(markdownToPlain('Add $HOME/bin to $PATH; it costs $5 and $10.\n\nC:\\Users\\jerry and /usr/local/bin, 50/50.')).toBe(
      'Add $HOME/bin to $PATH; it costs $5 and $10.\nC:\\Users\\jerry and /usr/local/bin, 50/50.',
    );
  });

  it('counts an amount between dollars as math only when it carries TeX', () => {
    expect(maths('between $10$ and $2^{10}$')).toEqual([{ text: '2^{10}', display: false }]);
  });

  it('sets an equation alone on its line apart, even inside a paragraph', () => {
    expect(maths('The area is\n$$\\pi r^2$$\nfor a circle, or $$x$$ inline.')).toEqual([
      { text: '\\pi r^2', display: true },
      { text: 'x', display: false },
    ]);
  });

  it('leaves an equation still streaming in as text until it closes', () => {
    expect(maths('Here: $$\n\\frac{a}{b')).toEqual([]);
    expect(maths('Here: $$\n\\frac{a}{b}\n$$')).toEqual([{ text: '\\frac{a}{b}', display: true }]);
  });

  it('splits a paragraph around a display equation and trims the breaks either side', () => {
    const [paragraph] = parseReply('The area is: $$\n\\pi r^2\n$$\nfor a circle.') as Tokens.Paragraph[];
    const runs = splitDisplayMath(paragraph.tokens);
    const shown = runs.map((r) => ('math' in r ? `math:${r.math.text}` : r.tokens.map((t) => ('text' in t ? t.text : '')).join('')));
    expect(shown).toEqual(['The area is:', 'math:\\pi r^2', 'for a circle.']);
  });

  it('leaves a paragraph without a display equation whole', () => {
    const [paragraph] = parseReply('Inline $x^2$ only.') as Tokens.Paragraph[];
    expect(splitDisplayMath(paragraph.tokens)).toEqual([{ tokens: paragraph.tokens }]);
  });

  it('takes the TeX out of a notification as Unicode', () => {
    expect(markdownToPlain('**Answer:** $x^2 + y^2 = z^2$, so \\(c = \\sqrt{25} = 5\\).')).toBe(
      'Answer: x² + y² = z², so c = √25 = 5.',
    );
  });
});
