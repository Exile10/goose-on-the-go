// Goose's question batches: each question answered with its options, or with the member's own words
// under "Other", or skipped (pond docs/architecture/my-goose-hub.md, part 1a). The screen offers
// "Other" itself; the Pond never lists it.

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';

import type { Question, QuestionBatch } from '@/models/anchors';
import { api } from '@/services/api-client';
import { confirm } from '@/services/haptics';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import type { QuestionAnswerWire } from '@/services/types';
import { hubAction, useHubRead } from './hub-read';

/** Questions arrive when Goose starts on a plan; a read every couple of minutes while in front. */
export const QUESTIONS_MS = 2 * 60_000;

/** What the member has chosen so far for one question. */
export interface AnswerDraft {
  choices: string[];
  /** "Other" is chosen; its words are `text`. */
  other: boolean;
  text: string;
}

export const EMPTY_DRAFT: AnswerDraft = { choices: [], other: false, text: '' };

/** One option picked: a single-answer question keeps only it, a multi one toggles it. */
export function pick(question: Pick<Question, 'multi'>, draft: AnswerDraft, option: string): AnswerDraft {
  if (!question.multi) return { ...draft, choices: [option], other: false };
  const has = draft.choices.includes(option);
  return { ...draft, choices: has ? draft.choices.filter((c) => c !== option) : [...draft.choices, option] };
}

/** "Other" chosen or let go: in a single-answer question it stands in for the options. */
export function pickOther(question: Pick<Question, 'multi'>, draft: AnswerDraft, on: boolean): AnswerDraft {
  if (!question.multi && on) return { ...draft, choices: [], other: true };
  return { ...draft, other: on };
}

/** Whether there is anything to send: a choice, or words under "Other". */
export function canAnswer(draft: AnswerDraft): boolean {
  return draft.choices.length > 0 || (draft.other && draft.text.trim().length > 0);
}

/** The answer as the Pond takes it: the choices, and the member's words only when "Other" holds some. */
export function answerBody(draft: AnswerDraft): QuestionAnswerWire {
  const words = draft.other ? draft.text.trim() : '';
  return { choices: [...draft.choices], ...(words ? { text: words } : {}) };
}

export interface QuestionFilter {
  /** Only the batches about this plan. */
  anchorId?: string | null;
  /** Only this batch, as a notification names it. */
  batchId?: string | null;
}

/** The batches a screen shows: one named batch, a plan's batches, or all of them. */
export function batchesFor(batches: readonly QuestionBatch[], filter: QuestionFilter | undefined): QuestionBatch[] {
  if (filter?.batchId) {
    const named = batches.filter((b) => b.id === filter.batchId);
    if (named.length) return named;
  }
  if (filter?.anchorId) return batches.filter((b) => b.anchorId === filter.anchorId);
  return [...batches];
}

/** The batches with one question taken out, and a batch left with none taken out too. */
export function withoutQuestion(batches: readonly QuestionBatch[], questionId: string): QuestionBatch[] {
  return batches.map((b) => ({ ...b, questions: b.questions.filter((q) => q.id !== questionId) })).filter((b) => b.questions.length > 0);
}

export function useQuestions(filter?: QuestionFilter, enabled = true) {
  const read = useHubRead<QuestionBatch[]>('questions', () => api.questions(), [], QUESTIONS_MS, enabled);
  const { data, setData } = read;
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const latestDrafts = useRef(drafts);
  useEffect(() => {
    latestDrafts.current = drafts;
  });

  const anchorId = filter?.anchorId ?? null;
  const batchId = filter?.batchId ?? null;
  const batches = useMemo(() => batchesFor(data, { anchorId, batchId }), [data, anchorId, batchId]);

  const draftOf = useCallback((id: string) => drafts[id] ?? EMPTY_DRAFT, [drafts]);
  const change = useCallback((id: string, next: (d: AnswerDraft) => AnswerDraft) => setDrafts((all) => ({ ...all, [id]: next(all[id] ?? EMPTY_DRAFT) })), []);

  const choose = useCallback((question: Question, option: string) => change(question.id, (d) => pick(question, d, option)), [change]);
  const chooseOther = useCallback((question: Question, on: boolean) => change(question.id, (d) => pickOther(question, d, on)), [change]);
  const setOtherText = useCallback((question: Question, text: string) => change(question.id, (d) => ({ ...d, other: true, text })), [change]);

  const settle = useCallback(
    (question: Question) => {
      setData((all) => withoutQuestion(all, question.id));
      setDrafts((all) => {
        const rest = { ...all };
        delete rest[question.id];
        return rest;
      });
    },
    [setData],
  );

  /** Resolves whether the Pond took the answer. */
  const answer = useCallback(
    async (question: Question): Promise<boolean> => {
      const draft = latestDrafts.current[question.id] ?? EMPTY_DRAFT;
      if (!canAnswer(draft)) return false;
      setBusy(question.id);
      const done = await hubAction('questions', () => api.answerQuestion(question.id, answerBody(draft)).then(() => true));
      setBusy(null);
      if (!done) return false;
      settle(question);
      void confirm();
      showSnackbar({ message: i18n.t('goose.questions.thanks'), tone: 'success' });
      return true;
    },
    [settle],
  );

  const skip = useCallback(
    async (question: Question): Promise<boolean> => {
      setBusy(question.id);
      const done = await hubAction('questions', () => api.skipQuestion(question.id).then(() => true));
      setBusy(null);
      if (!done) return false;
      settle(question);
      return true;
    },
    [settle],
  );

  const count = batches.reduce((n, b) => n + b.questions.length, 0);

  return { ...read, batches, count, busy, draftOf, actions: { reload: read.reload, choose, chooseOther, setOtherText, answer, skip } };
}

export type UseQuestions = ReturnType<typeof useQuestions>;
