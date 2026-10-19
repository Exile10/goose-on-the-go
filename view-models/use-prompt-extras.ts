/**
 * Assistant notes: the Pond's prompt extras, which it adds to the assistant's instructions on every
 * turn. `models/prompt-extras.ts` says how a note reaches the model and why a length is advised.
 *
 * A poll, because the desktop dashboard and the API edit the same notes and send this phone
 * nothing when they do. Behind the Developer toggle for `settings`, as the rest of the Assistant
 * page is: on mock, `SAMPLE_PROMPT_EXTRAS` render and the actions change them locally.
 *
 * Every route is the Pond's protected tier, which any paired phone's token passes; nothing here
 * is owner-only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { PromptExtra } from '@/services/types';
import { SAMPLE_PROMPT_EXTRAS, inPondOrder, newNote, problemKey } from '@/models/prompt-extras';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';

/** Notes change when somebody edits them, which is rare; a minute keeps another editor's in view. */
export const PROMPT_EXTRAS_MS = 60_000;

export interface UsePromptExtras {
  data: { extras: PromptExtra[] };
  loading: boolean;
  /** Why the last read, switch or removal failed, for the screen to show. */
  error: string | null;
  /** A load failed and nothing has loaded yet: unknown, not empty. See useSchedules. */
  failed: boolean;
  actions: {
    refresh: () => Promise<void>;
    /** Resolves to why it was not saved, or null once the Pond has it. */
    add: (name: string, text: string) => Promise<string | null>;
    /** Resolves to why the new words were not saved, or null once the Pond has them. */
    edit: (extra: PromptExtra, text: string) => Promise<string | null>;
    /** A refusal leaves the note as it was and says why in `error`. */
    setActive: (extra: PromptExtra, active: boolean) => Promise<void>;
    /** A refusal puts the note back and says why in `error`. */
    remove: (extra: PromptExtra) => Promise<void>;
  };
}

/**
 * A 501 is a Pond built without the notes store; a 400 says what was wrong with the body. The rest
 * is the shared reading, which is null when the connection banner already says it.
 */
export function describePromptExtraError(e: unknown): string | null {
  if (e instanceof ApiError && e.status === 501) return i18n.t('promptNotes.errors.unavailable');
  if (e instanceof ApiError && e.status === 400 && e.detail) return e.detail;
  return describeApiError(e);
}

export function usePromptExtras(): UsePromptExtras {
  const { hydrated, isScreenReal } = useServer();
  const real = isScreenReal('settings');

  const [extras, setExtras] = useState<PromptExtra[]>(() => (real ? [] : SAMPLE_PROMPT_EXTRAS));
  const [loading, setLoading] = useState(real);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // The Developer toggle swapping the source; see useSchedules.
  const [source, setSource] = useState(real);
  if (source !== real) {
    setSource(real);
    setExtras(real ? [] : SAMPLE_PROMPT_EXTRAS);
    setLoading(real);
    setError(null);
    setFailed(false);
  }

  const loaded = useRef(false);
  useEffect(() => {
    loaded.current = false;
  }, [real]);
  // A read that started before a local change must not undo it when it lands.
  const changes = useRef(0);

  const load = useCallback(
    async (loud: boolean) => {
      if (!real) return;
      if (loud) {
        setLoading(true);
        setError(null);
      }
      const startedAt = changes.current;
      try {
        const list = await api.listPromptExtras();
        if (startedAt === changes.current) setExtras(inPondOrder(list));
        loaded.current = true;
        setError(null);
        setFailed(false);
      } catch (e) {
        if (loud || !loaded.current) setError(describePromptExtraError(e));
        else console.warn('[prompt-extras] refresh failed; showing the last result', e instanceof ApiError ? e.status : 'network');
        if (!loaded.current) setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [real],
  );

  const refresh = useCallback(() => load(true), [load]);

  useLive(() => load(false), PROMPT_EXTRAS_MS, hydrated && real);

  /** Saves `next` over whatever has its key, and resolves to why the Pond refused it, if it did. */
  const put = useCallback(
    async (next: PromptExtra): Promise<string | null> => {
      try {
        if (real) await api.savePromptExtra(next);
        changes.current += 1;
        setExtras((current) => inPondOrder([...current.filter((e) => e.key !== next.key), next]));
        return null;
      } catch (e) {
        return describePromptExtraError(e) ?? i18n.t('promptNotes.errors.saveFailed');
      }
    },
    [real],
  );

  const add = useCallback(
    async (name: string, text: string) => {
      // Checked against the list on screen, so a taken name is refused before the Pond replaces it.
      const made = newNote(name, text, extras);
      if ('problem' in made) return i18n.t(problemKey(made.problem));
      return put(made.note);
    },
    [extras, put],
  );

  const edit = useCallback(
    async (extra: PromptExtra, text: string) => {
      const instruction = text.trim();
      if (!instruction) return i18n.t(problemKey('textRequired'));
      return put({ ...extra, instruction });
    },
    [put],
  );

  const setActive = useCallback(
    async (extra: PromptExtra, active: boolean) => {
      setError(null);
      const refused = await put({ ...extra, active });
      if (refused) setError(refused);
    },
    [put],
  );

  const remove = useCallback(
    async (extra: PromptExtra) => {
      setError(null);
      changes.current += 1;
      setExtras((current) => current.filter((e) => e.key !== extra.key));
      if (!real) return;
      try {
        await api.deletePromptExtra(extra.key);
      } catch (e) {
        changes.current += 1;
        setExtras((current) => inPondOrder([...current.filter((e2) => e2.key !== extra.key), extra]));
        setError(describePromptExtraError(e) ?? i18n.t('promptNotes.errors.deleteFailed'));
      }
    },
    [real],
  );

  return { data: { extras }, loading, error, failed, actions: { refresh, add, edit, setActive, remove } };
}
