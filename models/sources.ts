// The pages an answer or report came from, as the chips number them: the pages its text cites, in
// citing order, then the other pages read for it.

import { siteOf } from '@/models/web-watches';

export interface CitedSource {
  title: string;
  url: string;
}

const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

/**
 * What to call a cited page. A link named only for its site ("Wikipedia") says nothing about the
 * page, so the page's own name is read from the end of its address instead.
 */
function titleOf(text: string, url: string): string {
  const label = text.trim();
  const squashed = label.toLowerCase().replace(/[^a-z0-9]/g, '');
  const namesSite = squashed === '' || siteOf(url).toLowerCase().replace(/[^a-z0-9]/g, '').includes(squashed);
  if (!namesSite) return label;
  const last = url.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() ?? '';
  let words = last;
  try {
    words = decodeURIComponent(last);
  } catch {
    // A malformed escape: the address as written is still better than nothing.
  }
  words = words.replace(/\.(html?|php|aspx?)$/i, '').replace(/[_+-]+/g, ' ').trim();
  return /[a-z]/i.test(words) && !words.includes(siteOf(url)) ? words : label || siteOf(url);
}

/** The web pages a text links to, in the order first cited, once each. */
export function citedLinks(markdown: string): CitedSource[] {
  const out: CitedSource[] = [];
  for (const m of markdown.matchAll(LINK)) {
    const url = m[2];
    if (!out.some((s) => s.url === url)) out.push({ title: titleOf(m[1], url), url });
  }
  return out;
}

/** The cited pages first, in citing order, then the other pages read; each once, by the name the page gave itself when read. */
export function mergeSources(cited: CitedSource[], read: CitedSource[]): CitedSource[] {
  const out = cited.map((c) => ({ ...c, title: read.find((r) => r.url === c.url && r.title.trim())?.title ?? c.title }));
  for (const s of read) if (!out.some((o) => o.url === s.url)) out.push(s);
  return out;
}
