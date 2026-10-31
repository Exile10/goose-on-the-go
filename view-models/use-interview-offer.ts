/**
 * Home's offer of the setup interview to whoever this phone belongs to: start it, carry on, or check
 * what Goose drafted. Every member gets it on their own phone, not only the owner who ran setup, and
 * it goes once the interview is done or the member puts it away.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';

import { inviteFor, type InterviewInvite } from '@/models/interview';
import { storageFamily } from '@/services/storage';
import type { ProfileInterview } from '@/services/types';
import { useInterview } from './use-interview';

const family = storageFamily('interviewOffer');

export interface UseInterviewOffer {
  invite: InterviewInvite | null;
  interview: ProfileInterview | null;
  busy: boolean;
  error: string | null;
  actions: { open: () => Promise<void>; dismiss: () => void };
}

export function useInterviewOffer(): UseInterviewOffer {
  const router = useRouter();
  const { data, error, actions } = useInterview();
  const { interview } = data;
  const member = interview?.profileId ?? null;
  // Unknown until read, so a put-away offer never flashes on.
  const [putAway, setPutAway] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!member) return;
    let live = true;
    void family
      .getJSON<boolean>(member)
      .then((v) => live && setPutAway(v === true))
      .catch(() => live && setPutAway(false));
    return () => {
      live = false;
    };
  }, [member]);

  const open = useCallback(async () => {
    if (!interview || busy) return;
    setBusy(true);
    try {
      // A draft is waiting in its own session; starting again would only add a welcome back to it.
      const target = interview.status === 'awaiting_approval' && interview.sessionId ? interview : await actions.start();
      if (target?.sessionId) {
        router.push({ pathname: '/conversation', params: { session: target.sessionId, interview: target.profileId } });
      }
    } finally {
      setBusy(false);
    }
  }, [actions, busy, interview, router]);

  const dismiss = useCallback(() => {
    if (!member) return;
    setPutAway(true);
    void family.setJSON(member, true).catch(() => undefined);
  }, [member]);

  return {
    invite: putAway === false ? inviteFor(interview) : null,
    interview,
    busy,
    error,
    actions: { open, dismiss },
  };
}
