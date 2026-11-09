// What Goose knows the member is into, the interview that builds it, and the Pond's portrait of
// them (docs/MY-GOOSE-HUB.md, part 1). Read defensively: an unknown category is "other", an
// unknown depth the lightest, an unknown news choice "off", so nothing feeds the news by accident.

import type { TranslationKey } from '@/services/i18n';
import type { InterestCategoryWire, InterestDepthWire, InterestNewsWire, InterestWriteWire } from '@/services/types';

import { count, list, oneOf, pondPath, readAll, record, strings, text, time } from './me-read';

export type InterestCategory = InterestCategoryWire;
export type InterestDepth = InterestDepthWire;
export type InterestNews = InterestNewsWire;
export type InterestOrigin = 'interview' | 'chat' | 'you';

export const CATEGORIES: readonly InterestCategory[] = [
  'sport', 'tech', 'science', 'business', 'money', 'politics', 'culture', 'film_tv', 'music', 'games', 'books',
  'food', 'travel', 'health', 'home', 'cars', 'shopping', 'people', 'places', 'learning', 'other',
];
export const DEPTHS: readonly InterestDepth[] = ['curious', 'keen', 'devoted'];
export const NEWS_CHOICES: readonly InterestNews[] = ['off', 'tiles', 'digest', 'both'];
const ORIGINS: readonly InterestOrigin[] = ['interview', 'chat', 'you'];

export interface Interest {
  id: string;
  topic: string;
  category: InterestCategory;
  facets: string[];
  depth: InterestDepth;
  news: InterestNews;
  avoid: boolean;
  origin: InterestOrigin;
  evidence: number;
  confirmed: boolean;
  /** The topic's own picture, a Pond path, when the Pond found one. */
  picture: string | null;
  updatedAt: string | null;
}

export function readInterest(raw: unknown): Interest | null {
  const r = record(raw);
  const id = text(r?.id);
  const topic = text(r?.topic);
  if (!r || !id || !topic) return null;
  return {
    id,
    topic,
    category: oneOf(r.category, CATEGORIES, 'other'),
    facets: strings(r.facets),
    depth: oneOf(r.depth, DEPTHS, 'curious'),
    news: oneOf(r.news, NEWS_CHOICES, 'off'),
    avoid: r.avoid === true,
    origin: oneOf(r.origin, ORIGINS, 'chat'),
    evidence: count(r.evidence),
    confirmed: r.confirmed === true,
    picture: pondPath(r.picture),
    updatedAt: time(r.updated_at),
  };
}

export function readInterests(raw: unknown): Interest[] {
  return readAll(raw, 'interests', readInterest);
}

/** The Pond offers a guess for the member to confirm once it has seen it twice. */
export const GUESS_EVIDENCE = 2;

/** Confirmed interests first, as the member set them, then guesses worth asking about, best first. */
export function sortInterests(interests: readonly Interest[]): { confirmed: Interest[]; guesses: Interest[]; avoided: Interest[] } {
  const avoided = interests.filter((i) => i.avoid);
  const kept = interests.filter((i) => !i.avoid);
  return {
    confirmed: kept.filter((i) => i.confirmed),
    guesses: kept.filter((i) => !i.confirmed && i.evidence >= GUESS_EVIDENCE).sort((a, b) => b.evidence - a.evidence),
    avoided,
  };
}

/** The writable fields of an interest, as a PATCH or a POST sends them. */
export function interestWrite(edit: Partial<Pick<Interest, 'topic' | 'category' | 'facets' | 'depth' | 'news' | 'avoid'>>): InterestWriteWire {
  const out: InterestWriteWire = {};
  if (edit.topic !== undefined) out.topic = edit.topic.trim();
  if (edit.category !== undefined) out.category = edit.category;
  if (edit.facets !== undefined) out.facets = edit.facets.map((f) => f.trim()).filter(Boolean);
  if (edit.depth !== undefined) out.depth = edit.depth;
  if (edit.news !== undefined) out.news = edit.news;
  if (edit.avoid !== undefined) out.avoid = edit.avoid;
  return out;
}

export type InterviewStatus = 'not_started' | 'asking' | 'thinking' | 'review' | 'done';
const INTERVIEW_STATUSES: readonly InterviewStatus[] = ['not_started', 'asking', 'thinking', 'review', 'done'];

export interface InterviewTurn {
  id: string;
  role: 'goose' | 'you';
  text: string;
  choices: string[];
  multi: boolean;
  allowFree: boolean;
  at: string | null;
}

export interface InterestInterview {
  status: InterviewStatus;
  turns: InterviewTurn[];
  draft: Interest[];
  asked: number;
  planned: number;
}

function readTurn(raw: unknown, index: number): InterviewTurn | null {
  const r = record(raw);
  const words = text(r?.text);
  if (!r || !words) return null;
  return {
    id: text(r.id) || `turn-${index}`,
    role: r.role === 'you' ? 'you' : 'goose',
    text: words,
    choices: strings(r.choices),
    multi: r.multi === true,
    allowFree: r.allow_free === true,
    at: time(r.at),
  };
}

/**
 * The interview as the Pond has it. An unknown status reads as `done`, which offers to begin a new
 * round rather than wait on a question that may never come.
 */
export function readInterestInterview(raw: unknown): InterestInterview {
  const r = record(raw);
  return {
    status: oneOf(r?.status, INTERVIEW_STATUSES, 'done'),
    turns: list(r?.turns).flatMap((t, i) => {
      const turn = readTurn(t, i);
      return turn ? [turn] : [];
    }),
    draft: readAll(r?.draft, 'draft', readInterest),
    asked: count(r?.asked),
    planned: count(r?.planned),
  };
}

/** The question the member is being asked now: Goose's last turn, when nothing has answered it. */
export function openQuestion(interview: InterestInterview): InterviewTurn | null {
  if (interview.status !== 'asking') return null;
  const last = interview.turns.at(-1);
  return last && last.role === 'goose' ? last : null;
}

/** "Question 3 of about 8", once the Pond says how many it plans. */
export function interviewProgress(interview: InterestInterview): { asked: number; planned: number } | null {
  if (interview.planned <= 0) return null;
  return { asked: Math.min(Math.max(interview.asked, 1), interview.planned), planned: interview.planned };
}

export interface Portrait {
  summary: string;
  into: string[];
  workingOn: string[];
  likes: string[];
  updatedAt: string | null;
}

export function readPortrait(raw: unknown): Portrait | null {
  const r = record(raw);
  const summary = text(r?.summary);
  if (!r || !summary) return null;
  return { summary, into: strings(r.into), workingOn: strings(r.working_on), likes: strings(r.likes), updatedAt: time(r.updated_at) };
}

/** The initial a picture-less interest is drawn with. */
export function initialOf(topic: string): string {
  return (topic.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
}

/** Interests in the member's own order, kept on the phone, with any new ones after in the Pond's order. */
export function inMemberOrder<T extends { id: string }>(items: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...items]
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (rank.get(a.item.id) ?? order.length + a.i) - (rank.get(b.item.id) ?? order.length + b.i))
    .map(({ item }) => item);
}

export function categoryKey(category: InterestCategory): TranslationKey {
  switch (category) {
    case 'sport': return 'goose.interests.category.sport';
    case 'tech': return 'goose.interests.category.tech';
    case 'science': return 'goose.interests.category.science';
    case 'business': return 'goose.interests.category.business';
    case 'money': return 'goose.interests.category.money';
    case 'politics': return 'goose.interests.category.politics';
    case 'culture': return 'goose.interests.category.culture';
    case 'film_tv': return 'goose.interests.category.filmTv';
    case 'music': return 'goose.interests.category.music';
    case 'games': return 'goose.interests.category.games';
    case 'books': return 'goose.interests.category.books';
    case 'food': return 'goose.interests.category.food';
    case 'travel': return 'goose.interests.category.travel';
    case 'health': return 'goose.interests.category.health';
    case 'home': return 'goose.interests.category.home';
    case 'cars': return 'goose.interests.category.cars';
    case 'shopping': return 'goose.interests.category.shopping';
    case 'people': return 'goose.interests.category.people';
    case 'places': return 'goose.interests.category.places';
    case 'learning': return 'goose.interests.category.learning';
    case 'other': return 'goose.interests.category.other';
  }
}

export function depthKey(depth: InterestDepth): TranslationKey {
  switch (depth) {
    case 'curious': return 'goose.interests.depth.curious';
    case 'keen': return 'goose.interests.depth.keen';
    case 'devoted': return 'goose.interests.depth.devoted';
  }
}

export function newsKey(news: InterestNews): TranslationKey {
  switch (news) {
    case 'off': return 'goose.interests.news.off';
    case 'tiles': return 'goose.interests.news.tiles';
    case 'digest': return 'goose.interests.news.digest';
    case 'both': return 'goose.interests.news.both';
  }
}
