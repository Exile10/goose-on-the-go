/**
 * Goose's replies, read as markdown.
 *
 * The Pond's model writes markdown and only the voice path strips it, so the
 * chat has to draw it. marked's lexer does the reading;
 * `components/patterns/markdown.tsx` draws the tokens in Ink's type.
 */

import { lexer, type MarkedToken, type Token, type Tokens } from 'marked';

export type { MarkedToken, Token, Tokens };

/** Safe on a reply still streaming in: an unclosed fence is code to the end. */
export function parseReply(source: string): Token[] {
  return lexer(source, { gfm: true });
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** marked decodes numeric entities and leaves named ones for a browser, which this is not. */
export function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => NAMED[name]);
}

/** The model's text does not get to launch an app scheme or a script, so only the web opens. */
export function webLink(href: string | null | undefined): string | null {
  const url = href?.trim() ?? '';
  return /^https?:\/\/\S+$/i.test(url) ? url : null;
}

const MAP_HOSTS = /^(www\.)?(openstreetmap\.org|osm\.org|maps\.apple\.com|maps\.google\.com)$/i;

/** A web link to a map, which the phone hands to its maps app or browser rather than the in-app one. */
export function isMapLink(url: string): boolean {
  // Parsed by hand: React Native's URL has long lacked `hostname`.
  const parts = /^https?:\/\/([^/?#:@]+)(?::\d+)?(\/[^?#]*)?/i.exec(url);
  if (!parts) return false;
  const [, host, path = '/'] = parts;
  return MAP_HOSTS.test(host) || (/^(www\.)?google\.com$/i.test(host) && path.startsWith('/maps'));
}

/** HTML the model wrote is shown as the text it is, never drawn; only a line break keeps its meaning. */
export function htmlAsText(raw: string): string {
  return /^<br\s*\/?>$/i.test(raw.trim()) ? '\n' : raw;
}

/** A token's inline content as the words it shows: emphasis, code and links keep only their text. */
function inlineWords(tokens: Token[]): string {
  return tokens
    .map((token) => {
      const t = token as MarkedToken;
      if (t.type === 'br') return '\n';
      if (t.type === 'html') return htmlAsText(t.raw);
      if (t.type === 'image') return t.text;
      if ('tokens' in t && t.tokens) return inlineWords(t.tokens);
      return 'text' in t ? decodeEntities(t.text) : '';
    })
    .join('');
}

/** Block tokens as plain lines: a list keeps its bullets or numbers, a table its cells. */
function blockLines(tokens: Token[]): string[] {
  return tokens.flatMap((token): string[] => {
    const t = token as MarkedToken;
    switch (t.type) {
      case 'space':
      case 'hr':
        return [];
      case 'code':
        return [t.text];
      case 'blockquote':
        return blockLines(t.tokens);
      case 'list':
        return t.items.map((item, i) => {
          const marker = t.ordered ? `${(typeof t.start === 'number' ? t.start : 1) + i}. ` : '• ';
          return marker + blockLines(item.tokens).join(' ');
        });
      case 'table':
        return [t.header, ...t.rows].map((row) => row.map((cell) => inlineWords(cell.tokens)).join(' · '));
      case 'html':
        return [htmlAsText(t.raw)];
      default:
        if ('tokens' in t && t.tokens) return [inlineWords(t.tokens)];
        return 'text' in t ? [decodeEntities(t.text)] : [];
    }
  });
}

/**
 * The words a reply shows, with its markdown taken out, for a place that draws text as the
 * characters it is made of: a notification in the shade printed "**Weather**" as written.
 */
export function markdownToPlain(markdown: string): string {
  return blockLines(parseReply(markdown))
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}
