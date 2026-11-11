/**
 * What the Pond's scheduled questions last answered, for My Goose's News: the morning news a
 * household asked for once and gets every day. The Pond has no news route of its own; a brief is a
 * schedule's prompt and its latest completed run.
 */

import { useCallback, useState } from 'react';

import { briefFrom, type Brief } from '@/models/my-goose';
import { deviceTimeZone } from '@/models/schedule';
import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { useLive } from './use-live';

/** A brief is written once a day or so, so a read every few minutes while in front is plenty. */
export const BRIEFS_MS = 5 * 60_000;
/** Runs read per schedule: the latest to show, the rest as "Earlier". */
export const BRIEF_RUNS = 5;
/** One read per schedule, so a household with dozens is capped rather than fanned out. */
export const BRIEF_SCHEDULES = 8;
/** Seven in the morning, every day, in the six-field cron the Pond takes. */
export const MORNING_CRON = '0 0 7 * * *';

function failure(e: unknown): string {
  return e instanceof ApiError
    ? i18n.t('myGoose.errors.status', { status: e.status })
    : i18n.t('myGoose.errors.unreachable');
}

export interface UseBriefs {
  data: { briefs: Brief[]; asking: number };
  loading: boolean;
  error: string | null;
  starting: boolean;
  actions: {
    refresh: () => Promise<void>;
    startMorningNews: () => Promise<boolean>;
    runNow: (scheduleId: string) => Promise<void>;
  };
}

export function useBriefs(): UseBriefs {
  const { hydrated, isScreenReal } = useServer();
  const real = isScreenReal('schedule');
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [asking, setAsking] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    if (!real) {
      setLoading(false);
      return;
    }
    try {
      const prompts = (await api.listSchedules()).filter((s) => s.kind.type === 'agent_prompt').slice(0, BRIEF_SCHEDULES);
      // A schedule whose runs cannot be read has no brief to show; the others still do.
      const runs = await Promise.all(prompts.map((s) => api.listScheduleRuns(s.id, BRIEF_RUNS).catch(() => [])));
      const written = prompts
        .map((s, i) => briefFrom(s, runs[i]))
        .filter((b): b is Brief => b !== null)
        .sort((a, b) => b.at.localeCompare(a.at));
      setBriefs(written);
      setAsking(prompts.length);
      setError(null);
    } catch (e) {
      setError(failure(e));
    } finally {
      setLoading(false);
    }
  }, [real]);

  useLive(refresh, BRIEFS_MS, hydrated);

  const startMorningNews = useCallback(async () => {
    setStarting(true);
    try {
      await api.createSchedule({
        name: i18n.t('myGoose.news.morningName'),
        cron: MORNING_CRON,
        prompt: i18n.t('myGoose.news.morningPrompt'),
        timezone: deviceTimeZone(),
      });
      await refresh();
      return true;
    } catch (e) {
      setError(failure(e));
      return false;
    } finally {
      setStarting(false);
    }
  }, [refresh]);

  const runNow = useCallback(async (scheduleId: string) => {
    try {
      await api.runScheduleNow(scheduleId);
    } catch (e) {
      setError(failure(e));
    }
  }, []);

  return { data: { briefs, asking }, loading, error, starting, actions: { refresh, startMorningNews, runNow } };
}
