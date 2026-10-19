/**
 * The one way the app decides whether some text answers a typed search, shared by the
 * conversation wall and the Settings screen so a query behaves the same in both.
 */

/** Case and accents folded away, so "cafe" finds "Café". */
export function fold(text: string): string {
  const decomposed = typeof text.normalize === 'function' ? text.normalize('NFD') : text;
  return decomposed.replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Whether a query has anything in it to search for once whitespace is gone. */
export function isBlankQuery(query: string): boolean {
  return query.trim().length === 0;
}

/**
 * Whether `fields` answer a query: every word of it, somewhere across the fields, in any order.
 *
 * Matching the query as one run would make "cry devil" miss "Devil May Cry". Words in any order
 * is closer to what a half-remembered name gives you to search with. A blank query matches
 * everything; a missing field matches nothing.
 */
export function matchesQuery(fields: readonly (string | null | undefined)[], query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(fields.filter(Boolean).join(' '));
  return words.every((word) => haystack.includes(word));
}
