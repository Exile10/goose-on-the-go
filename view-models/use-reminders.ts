/**
 * Reminders the Pond lifted out of conversations: read them, and dismiss one.
 *
 * Dismissal is final. The Pond has no route that brings a reminder back, which
 * is why the screen asks before it calls `dismiss`. Each dismissal re-reads the
 * list rather than trusting a local removal, because the Pond is what decides
 * what is still pending (another phone may have dismissed it, or a batch pass
 * may have turned it into a proposal).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import type { Reminder } from '@/services/types';
import { describeApiError } from './describe-error';
import { relativeWhen } from './use-chat-history';
import { useLive } from './use-live';

/** Reminders arrive with a batch pass over conversations, so a slow poll is plenty. */
export const REMINDERS_MS = 60_000;

/** One reminder as the list shows it. */
export interface ReminderRow {
  id: string;
  /** What it is about. */
  text: string;
  /** The conversation's own words about when, or null when it used none. */
  due: string | null;
  /** When it was said, relative to now. */
  said: string;
}

/** Pure, so the mapping is testable without a Pond: no date is parsed out of `when_said`. */
export function toReminderRow(reminder: Reminder, now: Date, locale?: string): ReminderRow {
  const due = reminder.when_said.trim();
  return {
    id: reminder.id,
    text: reminder.about.trim(),
    due: due.length > 0 ? due : null,
    said: relativeWhen(reminder.said_at, now, locale, i18n.t('sessions.yesterday')),
  };
}

export interface UseReminders {
  data: { rows: ReminderRow[] };
  loading: boolean;
  /** Why the last read failed, when there is a sentence for it. */
  error: string | null;
  /** The first read failed and nothing has loaded, so an empty list says nothing. */
  failed: boolean;
  /** The id a dismissal is in flight for, so its button can show it. A refusal is a snackbar. */
  dismissing: string | null;
  actions: {
    refresh: () => Promise<void>;
    dismiss: (id: string) => Promise<void>;
  };
}

export function useReminders(): UseReminders {
  const { hydrated } = useServer();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [dismissing, setDismissing] = useState<string | null>(null);
  // What the snackbar's Try again calls: the current `dismiss`, set below once it is made.
  const retry = useRef<(id: string) => Promise<void>>(async () => {});

  // Whether a read has ever succeeded. After one, a failed poll keeps what is on screen.
  const loaded = useRef(false);

  /** `loud` is a read somebody asked for; a poll is quiet and keeps the last good list. */
  const load = useCallback(async (loud: boolean) => {
    if (loud) {
      setLoading(true);
      setError(null);
    }
    try {
      setReminders(await api.listReminders());
      loaded.current = true;
      setError(null);
      setFailed(false);
    } catch (e) {
      if (loud || !loaded.current) setError(describeApiError(e));
      else console.warn('[reminders] refresh failed; showing the last list', e instanceof ApiError ? e.status : 'network');
      if (!loaded.current) setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useLive(() => load(false), REMINDERS_MS, hydrated);
  const refresh = useCallback(() => load(true), [load]);

  const dismiss = useCallback(
    async (id: string) => {
      setDismissing(id);
      try {
        await api.dismissReminder(id);
        console.info('[reminders] dismissed', id);
      } catch (e) {
        console.warn('[reminders] dismiss failed', e instanceof ApiError ? e.status : 'network');
        // A 404 is the Pond saying nothing is waiting under that id for this phone: it went
        // another way first. The refresh below takes it off; the sentence says why it vanished,
        // and there is nothing to try again.
        if (e instanceof ApiError && e.status === 404) {
          showSnackbar({ message: i18n.t('reminders.errors.gone') });
        } else {
          showSnackbar({
            message: describeApiError(e) ?? i18n.t('reminders.errors.dismissFailed'),
            tone: 'danger',
            action: { label: i18n.t('common.retry'), onPress: () => void retry.current(id) },
          });
        }
      } finally {
        setDismissing(null);
      }
      await load(true);
    },
    [load],
  );
  useEffect(() => {
    retry.current = dismiss;
  }, [dismiss]);

  const now = new Date();
  const rows = reminders.map((r) => toReminderRow(r, now, i18n.language));

  return { data: { rows }, loading, error, failed, dismissing, actions: { refresh, dismiss } };
}
