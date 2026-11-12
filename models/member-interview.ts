// The one interview a member gives the Pond: fixed sections, tap answers, at most one follow-up a
// section, and a draft of facts and interests they approve at the end
// (pond docs/architecture/my-goose-hub.md, part 0c).

import { readInterest, type Interest, type InterviewTurn } from './interests';
import { count, list, oneOf, record, strings, text, textOrNull, time } from './me-read';

export const MEMBER_INTERVIEW_STATUSES = ['not_started', 'asking', 'thinking', 'review', 'done'] as const;
export type MemberInterviewStatus = (typeof MEMBER_INTERVIEW_STATUSES)[number];
export type NewsWish = 'digest' | 'tiles' | 'both' | 'none';

/** A fact the interview drafted, for the member to keep, reword or drop. */
export interface DraftFact {
  id: string;
  about: string;
  content: string;
}

export interface MemberInterview {
  status: MemberInterviewStatus;
  turns: InterviewTurn[];
  /** The section being asked, such as "Food and health". */
  heading: string | null;
  progress: { done: number; total: number };
  sections: { id: string; heading: string }[];
  facts: DraftFact[];
  interests: Interest[];
  news: NewsWish | null;
}

export const EMPTY_INTERVIEW: MemberInterview = {
  status: 'not_started',
  turns: [],
  heading: null,
  progress: { done: 0, total: 0 },
  sections: [],
  facts: [],
  interests: [],
  news: null,
};

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

/** An unknown status reads as `done`, which offers to begin again rather than wait for nothing. */
export function readMemberInterview(raw: unknown): MemberInterview {
  const r = record(raw);
  const progress = record(r?.progress);
  const wish = textOrNull(r?.news);
  return {
    status: oneOf(r?.status, MEMBER_INTERVIEW_STATUSES, 'done'),
    turns: list(r?.turns).flatMap((t, i) => readTurn(t, i) ?? []),
    heading: textOrNull(r?.heading),
    progress: { done: count(progress?.done), total: count(progress?.total) },
    sections: list(r?.sections).flatMap((s) => {
      const o = record(s);
      const id = text(o?.id);
      return o && id ? [{ id, heading: text(o.heading) }] : [];
    }),
    facts: list(r?.facts).flatMap((f) => {
      const o = record(f);
      const id = text(o?.id);
      const content = text(o?.content);
      return o && id && content ? [{ id, about: text(o.about), content }] : [];
    }),
    interests: list(r?.interests).flatMap((i) => readInterest(i) ?? []),
    news: wish ? oneOf(wish, ['digest', 'tiles', 'both', 'none'] as const, 'none') : null,
  };
}

/** The question waiting for an answer: the last turn, when it is Goose's. */
export function openQuestion(interview: MemberInterview): InterviewTurn | null {
  const last = interview.turns[interview.turns.length - 1];
  return interview.status === 'asking' && last?.role === 'goose' ? last : null;
}

export interface InterviewAnswer {
  choices?: string[];
  text?: string;
  skip?: boolean;
}

export interface InterviewApproval {
  /** Ids of the drafted facts to keep. */
  facts: string[];
  /** Ids of the drafted interests to keep. */
  interests: string[];
  /** A kept fact's sentence as the member reworded it, by fact id. */
  edits?: Record<string, string>;
  /** False to leave the member's news settings as they are. */
  news?: boolean;
}

export interface InterviewKept {
  facts: number;
  interests: number;
  news: boolean;
}

export function readKept(raw: unknown): InterviewKept {
  const r = record(raw);
  return { facts: count(r?.facts), interests: count(r?.interests), news: r?.news === true };
}
