// The one interview a member gives the Pond. The Pond asks every question in code, so an answer
// brings the next one at once; typed words are written up while the screen reads every 1.5 s; and
// nothing is kept until the member has ticked, reworded or dropped what was drafted.

import { useCallback, useMemo, useRef, useState } from 'react';

import {
  EMPTY_INTERVIEW,
  openQuestion,
  type InterviewAnswer,
  type InterviewApproval,
  type InterviewKept,
  type MemberInterview,
  type NewsWish,
} from '@/models/member-interview';
import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import { confirm } from '@/services/haptics';
import i18n, { type TranslationKey } from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import { hubAction, useHubRead } from './hub-read';
import { INTERVIEW_POLL_MS, useLive } from './use-live';

const SCOPE = 'member-interview';

/** Between questions the Pond changes nothing by itself, so a slow read. */
export const MEMBER_INTERVIEW_IDLE_MS = 60_000;

export function newsWishKey(wish: NewsWish): TranslationKey {
  switch (wish) {
    case 'digest':
      return 'goose.interviewOne.news.digest';
    case 'tiles':
      return 'goose.interviewOne.news.tiles';
    case 'both':
      return 'goose.interviewOne.news.both';
    case 'none':
      return 'goose.interviewOne.news.none';
  }
}

/** What the member changed in the draft. Kept as what was dropped, so a new draft starts all ticked. */
interface Picks {
  droppedFacts: string[];
  droppedInterests: string[];
  /** A fact's sentence as the member reworded it, by fact id. */
  edits: Record<string, string>;
  applyNews: boolean;
}

const ALL_KEPT: Picks = { droppedFacts: [], droppedInterests: [], edits: {}, applyNews: true };

function withDropped(dropped: string[], id: string, keep: boolean): string[] {
  const rest = dropped.filter((x) => x !== id);
  return keep ? rest : [...rest, id];
}

export interface ReviewFact {
  id: string;
  /** The sentence as it will be kept: the member's wording when they gave one. */
  content: string;
  kept: boolean;
}

export interface ReviewInterest {
  id: string;
  topic: string;
  kept: boolean;
}

export function useMemberInterview() {
  const { hydrated } = useServer();
  const acted = useRef(0);
  const out = useRef(false);
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<Picks>(ALL_KEPT);

  const interview = useHubRead<MemberInterview>(
    SCOPE,
    async function read(): Promise<MemberInterview> {
      const before = acted.current;
      const next = await api.memberInterview();
      // An action answered while this read was out, so what it read may be the question before.
      return before === acted.current ? next : read();
    },
    EMPTY_INTERVIEW,
    MEMBER_INTERVIEW_IDLE_MS,
  );
  const { data, setData, reload } = interview;

  // Its own loop: the hub read asks for its delay only after a read, and never waits under 5 s.
  useLive(reload, INTERVIEW_POLL_MS, hydrated && data.status === 'thinking', INTERVIEW_POLL_MS);

  const run = useCallback(async <T>(work: () => Promise<T>): Promise<T | null> => {
    // A second tap before the first is answered would land on the next question.
    if (out.current) return null;
    out.current = true;
    setBusy(true);
    const done = await hubAction(SCOPE, work);
    acted.current += 1;
    out.current = false;
    setBusy(false);
    return done;
  }, []);

  const move = useCallback(
    async (work: () => Promise<MemberInterview>) => {
      const next = await run(work);
      if (next) setData(next);
      return next;
    },
    [run, setData],
  );

  const start = useCallback(async () => {
    const next = await move(() => api.startMemberInterview());
    if (next) setPicks(ALL_KEPT);
    return next;
  }, [move]);

  const answer = useCallback(
    (reply: InterviewAnswer) => {
      const text = reply.text?.trim();
      const choices = reply.choices?.filter(Boolean) ?? [];
      if (!text && choices.length === 0) return Promise.resolve(null);
      return move(() => api.answerMemberInterview({ ...(choices.length ? { choices } : {}), ...(text ? { text } : {}) }));
    },
    [move],
  );

  const skip = useCallback(() => move(() => api.answerMemberInterview({ skip: true })), [move]);
  const finish = useCallback(() => move(() => api.finishMemberInterview()), [move]);

  const review = useMemo(() => {
    const facts: ReviewFact[] = data.facts.map((f) => ({ id: f.id, content: picks.edits[f.id] ?? f.content, kept: !picks.droppedFacts.includes(f.id) }));
    const interests: ReviewInterest[] = data.interests.map((i) => ({ id: i.id, topic: i.topic, kept: !picks.droppedInterests.includes(i.id) }));
    return {
      facts,
      interests,
      news: data.news,
      applyNews: picks.applyNews,
      keepCount: facts.filter((f) => f.kept).length + interests.filter((i) => i.kept).length,
    };
  }, [data.facts, data.interests, data.news, picks]);

  const keepFact = useCallback((id: string, keep: boolean) => setPicks((p) => ({ ...p, droppedFacts: withDropped(p.droppedFacts, id, keep) })), []);
  const keepInterest = useCallback(
    (id: string, keep: boolean) => setPicks((p) => ({ ...p, droppedInterests: withDropped(p.droppedInterests, id, keep) })),
    [],
  );
  const setApplyNews = useCallback((apply: boolean) => setPicks((p) => ({ ...p, applyNews: apply })), []);

  /** Blank, or the drafted sentence again, is no rewording: the fact goes back to how it was drafted. */
  const reword = useCallback(
    (id: string, sentence: string) => {
      const words = sentence.trim();
      const drafted = data.facts.find((f) => f.id === id)?.content;
      setPicks((p) => {
        const others = Object.fromEntries(Object.entries(p.edits).filter(([fact]) => fact !== id));
        return { ...p, edits: words && words !== drafted ? { ...others, [id]: words } : others };
      });
    },
    [data.facts],
  );

  /** Saves what is ticked. Resolves with what the Pond kept, or null when it could not. */
  const approve = useCallback(async (): Promise<InterviewKept | null> => {
    const facts = review.facts.filter((f) => f.kept).map((f) => f.id);
    const interests = review.interests.filter((i) => i.kept).map((i) => i.id);
    const edits = Object.fromEntries(Object.entries(picks.edits).filter(([id]) => facts.includes(id)));
    const approval: InterviewApproval = {
      facts,
      interests,
      ...(Object.keys(edits).length ? { edits } : {}),
      news: review.news !== null && picks.applyNews,
    };
    const kept = await run(() => api.approveMemberInterview(approval));
    if (!kept) return null;
    setPicks(ALL_KEPT);
    setData((d) => ({ ...d, status: 'done', facts: [], interests: [], news: null }));
    void confirm();
    showSnackbar(
      kept.facts + kept.interests > 0
        ? { message: i18n.t('goose.interviewOne.saved', { facts: kept.facts, interests: kept.interests }), tone: 'success' }
        : { message: i18n.t(kept.news ? 'goose.interviewOne.savedNews' : 'goose.interviewOne.savedNothing'), tone: 'neutral' },
    );
    return kept;
  }, [picks, review, run, setData]);

  return {
    ...interview,
    question: openQuestion(data),
    busy,
    review,
    actions: { reload, start, answer, skip, finish, approve, keepFact, keepInterest, reword, setApplyNews },
  };
}

export type UseMemberInterview = ReturnType<typeof useMemberInterview>;
