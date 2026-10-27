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
