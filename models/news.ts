// News written from the member's interests: picture tiles, each opening a story in Goose's own
// words, and a daily digest with pictures and references (docs/MY-GOOSE-HUB.md, part 2).

import type { InterestCategory } from './interests';
import { CATEGORIES } from './interests';
import { list, oneOf, pondPath, readAll, readSourceRefs, record, siteOf, text, time, webUrl, type SourceRef } from './me-read';

export interface NewsSettings {
  digest: boolean;
  /** "07:00", the member's own clock. */
  digestTime: string;
  spokenOnSpeaker: boolean;
  tiles: boolean;
  timezone: string;
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Defaults for a field the Pond left out: news is something a member turns on, never a surprise. */
export function readNewsSettings(raw: unknown): NewsSettings {
  const r = record(raw);
  const at = text(r?.digest_time);
  return {
    digest: r?.digest === true,
    digestTime: CLOCK.test(at) ? at : '07:00',
    spokenOnSpeaker: r?.spoken_on_speaker === true,
    tiles: r?.tiles === true,
    timezone: text(r?.timezone),
  };
}

export interface StoryInterest {
  id: string;
  topic: string;
  /** Null from a Pond that does not say, or on a digest section, which never carries it. */
  category: InterestCategory | null;
}

export type StoryKind = 'news' | 'long_read';

export interface Story {
  id: string;
  kind: StoryKind;
  headline: string;
  dek: string;
  picture: string | null;
  source: { name: string; url: string | null };
  interest: StoryInterest | null;
  publishedAt: string | null;
  writtenAt: string | null;
  read: boolean;
  /** Only on a story read back from the history. */
  readAt: string | null;
}

function readInterestRef(raw: unknown): StoryInterest | null {
  const r = record(raw);
  const topic = text(r?.topic);
  return topic ? { id: text(r?.id), topic, category: CATEGORIES.find((c) => c === r?.category) ?? null } : null;
}

export function readStory(raw: unknown): Story | null {
  const r = record(raw);
  const id = text(r?.id);
  const headline = text(r?.headline);
  if (!r || !id || !headline) return null;
  const source = record(r.source);
  const url = webUrl(source?.url);
  return {
    id,
    // An unknown kind is news: the tile it draws is the ordinary one.
    kind: r.kind === 'long_read' ? 'long_read' : 'news',
    headline,
    dek: text(r.dek),
    picture: pondPath(r.picture),
    source: { name: text(source?.name) || (url ? siteOf(url) : ''), url },
    interest: readInterestRef(r.interest),
    publishedAt: time(r.published_at),
    writtenAt: time(r.written_at),
    read: r.read === true,
    readAt: time(r.read_at),
  };
}

/** `GET /me/news/history`: what the member read in the last 30 days, most recent first. */
export function readHistory(raw: unknown): Story[] {
  return readAll(raw, 'stories', readStory).sort((a, b) => (b.readAt ?? '').localeCompare(a.readAt ?? ''));
}

/** A story is new for three hours after it was published (or written, when the page gave no date). */
export const FRESH_MS = 3 * 3_600_000;

export function isFresh(story: Pick<Story, 'publishedAt' | 'writtenAt'>, now: Date): boolean {
  const at = story.publishedAt ?? story.writtenAt;
  if (!at) return false;
  const age = now.getTime() - Date.parse(at);
  return age >= 0 && age < FRESH_MS;
}

/** "34m ago", "5h ago", "2d ago", or a date past a week: the meta line under a story. */
export function agoParts(iso: string, now: Date): { unit: 'now' | 'm' | 'h' | 'd' | 'date'; value: number } {
  const ms = Math.max(0, now.getTime() - Date.parse(iso));
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return { unit: 'now', value: 0 };
  if (minutes < 60) return { unit: 'm', value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'h', value: hours };
  const days = Math.floor(hours / 24);
  return days < 7 ? { unit: 'd', value: days } : { unit: 'date', value: Date.parse(iso) };
}

export interface StoryDetail extends Story {
  summary: string;
  whyYou: string;
  sources: SourceRef[];
}

export function readStoryDetail(raw: unknown): StoryDetail | null {
  const story = readStory(raw);
  const r = record(raw);
  if (!story || !r) return null;
  return { ...story, summary: text(r.summary), whyYou: text(r.why_you), sources: readSourceRefs(r.sources) };
}

export interface DigestPicture {
  path: string;
  caption: string;
  sourceUrl: string | null;
}

export interface DigestSection {
  interest: StoryInterest | null;
  heading: string;
  body: string;
  pictures: DigestPicture[];
  references: SourceRef[];
}

export interface Digest {
  id: string;
  title: string;
  writtenAt: string | null;
  intro: string;
  sections: DigestSection[];
  /** The Pond path that answers the digest as audio, or null when it offers none. */
  listen: string | null;
}

function readSection(raw: unknown): DigestSection | null {
  const r = record(raw);
  const heading = text(r?.heading);
  const body = text(r?.body);
  if (!r || (!heading && !body)) return null;
  return {
    interest: readInterestRef(r.interest),
    heading,
    body,
    pictures: list(r.pictures).flatMap((p) => {
      const o = record(p);
      const path = pondPath(o?.path);
      return path ? [{ path, caption: text(o?.caption), sourceUrl: webUrl(o?.source_url) }] : [];
    }),
    references: readSourceRefs(r.references),
  };
}

export function readDigest(raw: unknown): Digest | null {
  const r = record(raw);
  const id = text(r?.id);
  if (!r || !id) return null;
  return {
    id,
    title: text(r.title),
    writtenAt: time(r.written_at),
    intro: text(r.intro),
    sections: list(r.sections).flatMap((s) => {
      const section = readSection(s);
      return section ? [section] : [];
    }),
    listen: pondPath(r.listen),
  };
}

export interface DigestSummary {
  id: string;
  title: string;
  writtenAt: string | null;
}

export function readDigestList(raw: unknown): DigestSummary[] {
  return readAll(raw, 'digests', (d) => {
    const r = record(d);
    const id = text(r?.id);
    return id ? { id, title: text(r?.title), writtenAt: time(r?.written_at) } : null;
  });
}

export type NewsBlocked = 'no_interests' | 'web_search';

export interface NewsFeed {
  stories: Story[];
  digest: Digest | null;
  state: 'idle' | 'writing';
  nextDigestAt: string | null;
  lastWrittenAt: string | null;
  /** What stops the Pond writing news, when something does. An unknown reason is no reason. */
  blocked: NewsBlocked | null;
}

export function readNewsFeed(raw: unknown): NewsFeed {
  const r = record(raw);
  return {
    stories: readAll(r?.stories, 'stories', readStory),
    digest: readDigest(r?.digest),
    state: oneOf(r?.state, ['idle', 'writing'] as const, 'idle'),
    nextDigestAt: time(r?.next_digest_at),
    lastWrittenAt: time(r?.last_written_at),
    blocked: r?.blocked === 'no_interests' || r?.blocked === 'web_search' ? r.blocked : null,
  };
}

/** Headlines and long reads apart: a long read is a deep dive and is never set as a headline. */
export function splitStories(stories: readonly Story[]): { news: Story[]; longReads: Story[] } {
  return { news: stories.filter((s) => s.kind === 'news'), longReads: stories.filter((s) => s.kind === 'long_read') };
}

/** A picture a digest section leads with: its first, when it has one. */
export function leadPicture(section: DigestSection): DigestPicture | null {
  return section.pictures[0] ?? null;
}

/** The time of day a digest arrives, as a clock the time picker reads. */
export function clockParts(clock: string): { hour: number; minute: number } {
  const m = CLOCK.exec(clock);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : { hour: 7, minute: 0 };
}

export function clockText(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Stories grouped by the interest they came from, in the order the Pond sent them. */
export function storiesByInterest(stories: readonly Story[]): { topic: string | null; stories: Story[] }[] {
  const groups = new Map<string | null, Story[]>();
  for (const story of stories) {
    const key = story.interest?.topic ?? null;
    groups.set(key, [...(groups.get(key) ?? []), story]);
  }
  return [...groups.entries()].map(([topic, grouped]) => ({ topic, stories: grouped }));
}
