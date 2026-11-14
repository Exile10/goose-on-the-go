// What the Pond remembers about the member, under headings, with the member's own hand on it
// (pond docs/architecture/my-goose-hub.md, part 0a).

import { count, list, readAll, record, text, textOrNull, time } from './me-read';

export interface AboutFact {
  id: string;
  content: string;
  /** The word it is filed under, such as `diet`; null for an older row not yet filed. */
  about: string | null;
  /** Allergy, health, partner: shown with care and never put in a notice's words. */
  sensitive: boolean;
  /** A household row: shown, and not the member's to change. */
  shared: boolean;
  createdAt: string | null;
  /** When a passing fact stops being shown. */
  expiresAt: string | null;
}

export interface AboutHeading {
  segment: string;
  heading: string;
  facts: AboutFact[];
}

/** A word a fact can be filed under, for the picker. */
export interface AboutWord {
  about: string;
  heading: string;
  /** A new fact under this word replaces the old one. */
  oneAtATime: boolean;
}

export interface AboutProfile {
  headings: AboutHeading[];
  /** Older rows the Pond has yet to file. */
  toFile: number;
  words: AboutWord[];
}

/** A row the Pond set aside when it re-sorted older memories, with its reason. */
export interface ArchivedFact extends AboutFact {
  why: string | null;
}

export const EMPTY_ABOUT: AboutProfile = { headings: [], toFile: 0, words: [] };

export function readFact(raw: unknown): AboutFact | null {
  const r = record(raw);
  const id = text(r?.id);
  const content = text(r?.content);
  if (!r || !id || !content) return null;
  return {
    id,
    content,
    about: textOrNull(r.about),
    sensitive: r.sensitive === true,
    shared: r.shared === true,
    createdAt: time(r.created_at),
    expiresAt: time(r.expires_at),
  };
}

export function readAbout(raw: unknown): AboutProfile {
  const r = record(raw);
  return {
    headings: list(r?.headings).flatMap((h) => {
      const o = record(h);
      const heading = text(o?.heading);
      if (!o || !heading) return [];
      const facts = list(o.facts).flatMap((f) => readFact(f) ?? []);
      return facts.length ? [{ segment: text(o.segment), heading, facts }] : [];
    }),
    toFile: count(r?.to_file),
    words: list(r?.words).flatMap((w) => {
      const o = record(w);
      const about = text(o?.about);
      return o && about ? [{ about, heading: text(o.heading), oneAtATime: o.one_at_a_time === true }] : [];
    }),
  };
}

export function readArchived(raw: unknown): ArchivedFact[] {
  return readAll(raw, 'facts', (f) => {
    const fact = readFact(f);
    return fact ? { ...fact, why: textOrNull(record(f)?.why) } : null;
  });
}

/** How many facts the profile shows. */
export function factCount(profile: AboutProfile): number {
  return profile.headings.reduce((n, h) => n + h.facts.length, 0);
}

/** The word's label for a picker row: "Diet", "Allergy". */
export function wordLabel(about: string): string {
  return about ? about.charAt(0).toUpperCase() + about.slice(1) : '';
}
