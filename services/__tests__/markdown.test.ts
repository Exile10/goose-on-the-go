import { decodeEntities, parseReply, webLink, type Tokens } from '../markdown';

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
