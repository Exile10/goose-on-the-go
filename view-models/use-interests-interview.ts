// The interests interview: Goose asks one question at a time with tap answers, the member answers,
// the Pond writes the next question (the screen reads every 1.5 s while it does), and at the end
// the member keeps or edits the drafted interests before saving them (docs/MY-GOOSE-HUB.md, part 1).

import { useCallback, useState } from 'react';

import { interestWrite, openQuestion, type InterestInterview } from '@/models/interests';
import { confirm } from '@/services/haptics';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import type { InterestWriteWire } from '@/services/types';
import { hubAction, useHubRead } from './hub-read';
import { INTERVIEW_POLL_MS } from './use-live';
import type { InterestEdit } from './use-interests';

/** Nothing happens between questions unless the Pond is writing one, so a slow read otherwise. */
export const INTERVIEW_IDLE_MS = 60_000;

const NOT_STARTED: InterestInterview = { status: 'not_started', turns: [], draft: [], asked: 0, planned: 0 };

export function useInterestsInterview(enabled = true) {
  const interview = useHubRead<InterestInterview>(
    'interview',
    (s) => s.interview(),
    NOT_STARTED,
    (d) => (d.status === 'thinking' ? INTERVIEW_POLL_MS : INTERVIEW_IDLE_MS),
    enabled,
  );
  const { source, setData, data } = interview;
  const [sending, setSending] = useState(false);

  const run = useCallback(
    async (work: () => Promise<InterestInterview>) => {
      setSending(true);
      const next = await hubAction('interview', work, { retry: true });
      setSending(false);
      if (next) setData(next);
      return next;
    },
    [setData],
  );

  const start = useCallback(() => run(() => source.startInterview()), [run, source]);
  const answer = useCallback(
    (reply: { text?: string; choices?: string[] }) => {
      const text = reply.text?.trim();
      const choices = reply.choices?.filter(Boolean) ?? [];
      if (!text && choices.length === 0) return Promise.resolve(null);
      return run(() => source.answerInterview({ ...(text ? { text } : {}), ...(choices.length ? { choices } : {}) }));
    },
    [run, source],
  );
  const finish = useCallback(() => run(() => source.finishInterview()), [run, source]);

  /** Saves the kept drafts with the member's edits. Resolves with how many were saved, or null. */
  const approve = useCallback(
    async (keep: string[], edits: Record<string, InterestEdit>) => {
      setSending(true);
      const body: Record<string, InterestWriteWire> = Object.fromEntries(Object.entries(edits).map(([id, e]) => [id, interestWrite(e)]));
      const saved = await hubAction('interview', () => source.approveInterview({ keep, edits: body }), { retry: true });
      setSending(false);
      if (saved === null) return null;
      setData((d) => ({ ...d, status: 'done', draft: [] }));
      void confirm();
      showSnackbar({ message: i18n.t('goose.interview.saved', { count: saved }), tone: 'success' });
      return saved;
    },
    [setData, source],
  );

  return { ...interview, question: openQuestion(data), sending, actions: { reload: interview.reload, start, answer, finish, approve } };
}

export type UseInterestsInterview = ReturnType<typeof useInterestsInterview>;
