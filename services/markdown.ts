/**
 * Goose's replies, read as markdown.
 *
 * The Pond's model writes markdown and only the voice path strips it, so the
 * chat has to draw it. marked's lexer does the reading;
 * `components/patterns/markdown.tsx` draws the tokens in Ink's type.
 */

import { Marked, type MarkedToken, type Token, type TokenizerExtension, type Tokens } from 'marked';

import { latexToUnicode } from './latex';

export type { MarkedToken, Token, Tokens };

/** A run of TeX the model wrote: in a sentence, or set apart on its own line. */
export interface MathToken {
  type: 'math';
  raw: string;
  text: string;
  display: boolean;
}

export function isMath(token: Token): token is Token & MathToken {
  return token.type === 'math';
}

/** A `\[` that holds no math is a model escaping a bracket, as in a citation `\[1\]`. */
const looksLikeMath = (tex: string) => /[\\^_{}=<>+\-*/|]|^\s*[A-Za-z]\s*$/.test(tex);

const BLOCK_DOLLARS = /^ {0,3}\$\$((?:[^$]|\$(?!\$))+?)\$\$[ \t]*(?:\n+|$)/;
const BLOCK_BRACKETS = /^ {0,3}\\\[((?:[^\\]|\\(?!\]))+?)\\\][ \t]*(?:\n+|$)/;

function displayBlock(src: string): MathToken | undefined {
  const brackets = BLOCK_BRACKETS.exec(src);
  const m = BLOCK_DOLLARS.exec(src) ?? brackets;
  const text = m?.[1].trim();
  if (!m || !text || (m === brackets && !looksLikeMath(text))) return undefined;
  return { type: 'math', raw: m[0], text, display: true };
}

/**
 * `$…$` only where it cannot be money or a shell variable: the opening `$` touches what follows it
 * and does not follow a word, the closing one touches what precedes it and no word follows it, and
 * an amount ("$5 and 10$") has to carry TeX to count.
 */
function dollarMath(src: string, before: string): MathToken | undefined {
  if (/[\w\\$]/.test(before) || src.length < 3 || /[\s$]/.test(src[1])) return undefined;
  for (let i = 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '\n' && src[i + 1] === '\n') return undefined;
    if (ch !== '$') continue;
    if (/\s/.test(src[i - 1]) || /\w/.test(src[i + 1] ?? '')) return undefined;
    const text = src.slice(1, i);
    if (/^\d/.test(text) && !/[\\^_{}=+]/.test(text)) return undefined;
    return { type: 'math', raw: src.slice(0, i + 1), text, display: false };
  }
  return undefined;
}

function inlineMath(src: string, previous: Token | undefined): MathToken | undefined {
  const before = previous?.raw.slice(-1) ?? '';
  // Set apart when it is the whole line or opens onto lines of its own, as `Here: $$⏎…⏎$$` does.
  const alone = (raw: string) =>
    /^\S{2}[ \t]*\n|\n[ \t]*\S{2}$/.test(raw) ||
    ((before === '' || before === '\n') && /^[ \t]*(?:\n|$)/.test(src.slice(raw.length)));
  const paren = /^\\\(((?:[^\\]|\\(?!\)))+?)\\\)/.exec(src);
  if (paren && paren[1].trim()) return { type: 'math', raw: paren[0], text: paren[1].trim(), display: false };
  const bracket = /^\\\[((?:[^\\]|\\(?!\]))+?)\\\]/.exec(src);
  if (bracket && bracket[1].trim() && looksLikeMath(bracket[1])) {
    return { type: 'math', raw: bracket[0], text: bracket[1].trim(), display: alone(bracket[0]) };
  }
  const dollars = /^\$\$((?:[^$]|\$(?!\$))+?)\$\$/.exec(src);
  if (dollars && dollars[1].trim()) {
    return { type: 'math', raw: dollars[0], text: dollars[1].trim(), display: alone(dollars[0]) };
  }
  return src[0] === '$' && src[1] !== '$' ? dollarMath(src, before) : undefined;
}

const mathBlock: TokenizerExtension = {
  name: 'mathBlock',
  level: 'block',
  // Only where a whole equation follows, or a paragraph would be cut at every line opening with `$$`.
  start(src) {
    for (const m of src.matchAll(/(^|\n) {0,3}(?:\$\$|\\\[)/g)) {
      const at = (m.index ?? 0) + m[1].length;
      if (displayBlock(src.slice(at))) return at;
    }
    return undefined;
  },
  tokenizer: (src) => displayBlock(src),
};

const mathInline: TokenizerExtension = {
  name: 'math',
  level: 'inline',
  start(src) {
    const at = src.search(/\$|\\[([]/);
    return at < 0 ? undefined : at;
  },
  tokenizer: (src, tokens) => inlineMath(src, tokens.at(-1)),
};

const reader = new Marked({ gfm: true, extensions: [mathBlock, mathInline] });

/** Safe on a reply still streaming in: an unclosed fence is code to the end, an unclosed `$$` is text. */
export function parseReply(source: string): Token[] {
  return reader.lexer(source);
}

/** The math in a reply, as the characters it reads as. */
export function mathText(token: MathToken): string {
  return latexToUnicode(token.text);
}

/** A paragraph's inline tokens, split where an equation is set on its own line. */
export type ParagraphRun = { math: MathToken } | { tokens: Token[] };

export function splitDisplayMath(tokens: Token[]): ParagraphRun[] {
  if (!tokens.some((t) => isMath(t) && t.display)) return [{ tokens }];
  const runs: ParagraphRun[] = [];
  let run: Token[] = [];
  const flush = () => {
    const trimmed = trimRun(run);
    if (trimmed.length) runs.push({ tokens: trimmed });
    run = [];
  };
  for (const token of tokens) {
    if (isMath(token) && token.display) {
      flush();
      runs.push({ math: token });
    } else {
      run.push(token);
    }
  }
  flush();
  return runs;
}

/** The line breaks that stood around an equation, taken off the text either side of it. */
function trimRun(tokens: Token[]): Token[] {
  const plain = (t: Token | undefined): t is Tokens.Text => t?.type === 'text' && !('tokens' in t && t.tokens);
  const out = tokens.filter((t, i) => !(t.type === 'br' && (i === 0 || i === tokens.length - 1)));
  const first = out[0];
  if (plain(first)) out[0] = { ...first, text: first.text.replace(/^\s+/, '') };
  const last = out[out.length - 1];
  if (plain(last)) out[out.length - 1] = { ...last, text: last.text.replace(/\s+$/, '') };
  return out.filter((t) => !(plain(t) && t.text === ''));
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ',
  thinsp: ' ', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', para: '¶',
  sect: '§', dagger: '†', times: '×', divide: '÷', plusmn: '±', minus: '−', le: '≤', ge: '≥', ne: '≠',
  asymp: '≈', infin: '∞', frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', micro: 'µ',
  euro: '€', pound: '£', yen: '¥', cent: '¢', larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔',
  check: '✓', shy: '',
};
const ENTITY = new RegExp(`&(?:(${Object.keys(NAMED).join('|')})|#(\\d{1,7})|#[xX]([0-9a-fA-F]{1,6}));`, 'g');

function codePoint(n: number, raw: string): string {
  return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : raw;
}

/**
 * marked leaves entities for a browser to decode, which this is not. One pass, so `&amp;lt;`
 * shows as the `&lt;` it spells rather than being decoded twice into `<`.
 */
export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (raw, name?: string, dec?: string, hex?: string) =>
    name ? NAMED[name] : codePoint(dec ? Number(dec) : parseInt(hex ?? '', 16), raw),
  );
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
      if (isMath(token)) return mathText(token);
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
    if (isMath(token)) return [mathText(token)];
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
