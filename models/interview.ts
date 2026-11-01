// The setup interview, in which Goose asks a member about themselves and keeps what matters as notes
// (goose-in-a-pond#731). Its wire shapes are read defensively: an unknown status reads as the one
// that asks the least of the member.

import type { TranslationKey } from '@/services/i18n';
import type {
  InterviewDraftNote,
  InterviewOffer,
  InterviewStatus,
  InterviewTopic,
  InterviewTopicStatus,
  MemberNotes,
  ProfileInterview,
  PromptExtra,
} from '@/services/types';

const STATUSES: readonly InterviewStatus[] = ['not_started', 'in_progress', 'awaiting_approval', 'done', 'stopped'];
const TOPIC_STATUSES: readonly InterviewTopicStatus[] = ['pending', 'answered', 'skipped'];

/** The prefix the interview's notes carry, one key per topic, so a member's own notes are told apart. */
export const INTERVIEW_KEY_PREFIX = 'me_';

function record(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function text(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}

function count(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

// An unknown status is treated as finished, so nothing offers to start what the Pond may not run.
function statusOf(raw: unknown): InterviewStatus {
  return STATUSES.find((s) => s === raw) ?? 'done';
}

export function readInterview(raw: unknown, profileId: string): ProfileInterview {
  const r = record(raw);
  const topics = Array.isArray(r?.topics) ? r.topics : [];
  const draft = Array.isArray(r?.draft) ? r.draft : [];
  return {
    profileId: text(r?.profile_id) || profileId,
    status: statusOf(r?.status),
    sessionId: text(r?.session_id) || null,
    topics: topics.flatMap((t): InterviewTopic[] => {
      const o = record(t);
      const id = text(o?.id);
      if (!id) return [];
      return [{ id, label: text(o?.label) || id, status: TOPIC_STATUSES.find((s) => s === o?.status) ?? 'pending' }];
    }),
    draft: draft.flatMap((d): InterviewDraftNote[] => {
      const o = record(d);
      const key = text(o?.key);
      const instruction = text(o?.instruction).trim();
      return key && instruction ? [{ key, topic: text(o?.topic), instruction }] : [];
    }),
  };
}

/** What `/onboard/complete` says of the owner's interview: null from an older Pond or with no owner yet. */
export function readInterviewOffer(raw: unknown): InterviewOffer | null {
  const offer = record(record(raw)?.interview);
  const profileId = text(offer?.profile_id);
  return offer && profileId ? { profileId, status: statusOf(offer.status) } : null;
}

export function readMemberNotes(raw: unknown): MemberNotes {
  const r = record(raw);
  const notes = Array.isArray(r?.notes) ? r.notes : [];
  const limits = record(r?.limits);
  return {
    notes: notes.flatMap((n): PromptExtra[] => {
      const o = record(n);
      const key = text(o?.key);
      if (!key) return [];
      return [{ key, instruction: text(o?.instruction), active: o?.active !== false, sort_order: count(o?.sort_order) }];
    }),
    limits: limits
      ? { maxNotes: count(limits.max_notes), maxTotalChars: count(limits.max_total_chars), usedChars: count(limits.used_chars) }
      : null,
  };
}

/** How far through the topics the member is: answered and skipped both count as dealt with. */
export function interviewProgress(topics: readonly InterviewTopic[]): { settled: number; total: number } {
  return { settled: topics.filter((t) => t.status !== 'pending').length, total: topics.length };
}

/** What Home offers for an interview: nothing once it is done, or for a Pond that has none. */
export type InterviewInvite = 'start' | 'resume' | 'review';

export function inviteFor(interview: Pick<ProfileInterview, 'status'> | null): InterviewInvite | null {
  switch (interview?.status) {
    case 'not_started':
      return 'start';
    case 'in_progress':
    case 'stopped':
      return 'resume';
    case 'awaiting_approval':
      return 'review';
    default:
      return null;
  }
}

const TOPIC_NAMES: Record<string, TranslationKey> = {
  address: 'interview.topics.address',
  identity: 'interview.topics.identity',
  language: 'interview.topics.language',
  household: 'interview.topics.household',
  routine: 'interview.topics.routine',
  food: 'interview.topics.food',
  access: 'interview.topics.access',
  style: 'interview.topics.style',
  avoid: 'interview.topics.avoid',
  other: 'interview.topics.other',
};

/**
 * The phone's own name for a topic, by its id or its note's key, so the names translate with the app.
 * Null for a topic a newer Pond added, whose own label stands in.
 */
export function topicNameKey(idOrKey: string): TranslationKey | null {
  const id = idOrKey.startsWith(INTERVIEW_KEY_PREFIX) ? idOrKey.slice(INTERVIEW_KEY_PREFIX.length) : idOrKey;
  return TOPIC_NAMES[id] ?? null;
}

/** Each drafted note with its topic's id and the Pond's label for it, in the order the topics were asked. */
export function draftByTopic(interview: ProfileInterview): { key: string; topic: string; label: string; instruction: string }[] {
  const order = new Map(interview.topics.map((t, i) => [t.id, i]));
  const label = new Map(interview.topics.map((t) => [t.id, t.label]));
  return [...interview.draft]
    .sort((a, b) => (order.get(a.topic) ?? order.size) - (order.get(b.topic) ?? order.size))
    .map((d) => ({ key: d.key, topic: d.topic, label: label.get(d.topic) ?? d.topic, instruction: d.instruction }));
}

/** The interview's notes first, in topic order, then any other note the member has. */
export function inTopicOrder(notes: readonly PromptExtra[]): PromptExtra[] {
  const ids = Object.keys(TOPIC_NAMES);
  const rank = (key: string) => {
    const i = key.startsWith(INTERVIEW_KEY_PREFIX) ? ids.indexOf(key.slice(INTERVIEW_KEY_PREFIX.length)) : -1;
    return i < 0 ? ids.length : i;
  };
  return [...notes].sort((a, b) => rank(a.key) - rank(b.key) || a.sort_order - b.sort_order);
}
