/**
 * The notes Goose keeps about this phone's member, which only their own conversations carry, and the
 * interview that writes them. They live beside the household's Assistant notes and share their limits.
 *
 * A phone attributed to nobody in a bigger household, or a Pond built before member notes, has none
 * to show, so `available` is false and the section is left off rather than drawn as a failure.
 */

import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { PromptExtra, ProfileInterview } from '@/services/types';
import { inTopicOrder } from '@/models/interview';
import { problemKey } from '@/models/prompt-extras';
import { describePromptExtraError } from './use-prompt-extras';

export interface UseMemberNotes {
  data: { available: boolean; notes: PromptExtra[]; interview: ProfileInterview | null };
  loading: boolean;
  error: string | null;
  actions: {
    refresh: () => Promise<void>;
    /** Resolves to why the new words were not saved, or null once the Pond has them. */
    edit: (note: PromptExtra, text: string) => Promise<string | null>;
    setActive: (note: PromptExtra, active: boolean) => Promise<void>;
    remove: (note: PromptExtra) => Promise<void>;
    /** Start or take up the interview; resolves to where to open it, or null when it would not start. */
    ask: () => Promise<{ sessionId: string; profileId: string } | null>;
  };
}

export function useMemberNotes(): UseMemberNotes {
  const { hydrated, paired } = useServer();
  const [member, setMember] = useState<string | null>(null);
  const [notes, setNotes] = useState<PromptExtra[]>([]);
  const [interview, setInterview] = useState<ProfileInterview | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const memberRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const id = memberRef.current ?? (await api.deviceSelf()).profile?.id ?? null;
      memberRef.current = id;
      setMember(id);
      if (!id) {
        setAvailable(false);
        return;
      }
      const [read, current] = await Promise.all([api.memberNotes(id), api.interview(id).catch(() => null)]);
      setNotes(inTopicOrder(read.notes));
      setInterview(current);
      setAvailable(true);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setAvailable(false);
      else setError(describePromptExtraError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // On focus, since the interview opened from here changes them while this screen waits underneath.
  useFocusEffect(
    useCallback(() => {
      if (hydrated && paired) void refresh();
    }, [hydrated, paired, refresh]),
  );

  const put = useCallback(
    async (note: PromptExtra): Promise<string | null> => {
      if (!member) return null;
      const before = notes;
      setNotes((current) => current.map((n) => (n.key === note.key ? note : n)));
      try {
        await api.saveMemberNote(member, note);
        return null;
      } catch (e) {
        setNotes(before);
        return describePromptExtraError(e) ?? i18n.t('promptNotes.errors.saveFailed');
      }
    },
    [member, notes],
  );

  const edit = useCallback(
    async (note: PromptExtra, text: string) => {
      const instruction = text.trim();
      if (!instruction) return i18n.t(problemKey('textRequired'));
      return put({ ...note, instruction });
    },
    [put],
  );

  const setActive = useCallback(
    async (note: PromptExtra, active: boolean) => {
      setError(null);
      const refused = await put({ ...note, active });
      if (refused) setError(refused);
    },
    [put],
  );

  const remove = useCallback(
    async (note: PromptExtra) => {
      if (!member) return;
      setError(null);
      setNotes((current) => current.filter((n) => n.key !== note.key));
      try {
        await api.deleteMemberNote(member, note.key);
      } catch (e) {
        setNotes((current) => inTopicOrder([...current, note]));
        setError(describePromptExtraError(e) ?? i18n.t('promptNotes.errors.deleteFailed'));
      }
    },
    [member],
  );

  const ask = useCallback(async () => {
    if (!member) return null;
    try {
      const started = await api.startInterview(member);
      setInterview(started);
      return started.sessionId ? { sessionId: started.sessionId, profileId: member } : null;
    } catch (e) {
      setError(describePromptExtraError(e) ?? i18n.t('interview.startFailed'));
      return null;
    }
  }, [member]);

  return { data: { available, notes, interview }, loading, error, actions: { refresh, edit, setActive, remove, ask } };
}
