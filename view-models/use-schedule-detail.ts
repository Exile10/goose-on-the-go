/**
 * One schedule as the Pond has it, for its own screen: what it runs, when,
 * its recent runs, and every change the Pond takes for it.
 *
 * The Pond has no `GET /schedules/{id}`, so the schedule is found in
 * `GET /schedules`. That read is polled while the screen is in front: quickly
 * while a run is going, so its end shows up, and slowly otherwise, for the
 * next run the scheduler works out. The run history is read again when a run
 * this screen watched has finished.
 *
 * On mock (the Developer toggle, dev builds only) the schedule is one of
 * `SAMPLE_SCHEDULES` and changes are made to it here alone.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import type { Schedule, UpdateScheduleRequest } from '@/services/types';
import { SAMPLE_SCHEDULES, isRule } from '@/models/schedule';
import { useLive } from './use-live';
import { useScheduleRuns, type UseScheduleRuns } from './use-schedule-runs';
import { SCHEDULES_ACTIVE_MS, SCHEDULES_IDLE_MS, describeScheduleError } from './use-schedules';

export interface UseScheduleDetail {
  /** Null until it has loaded, and when it is not on the Pond. */
  schedule: Schedule | null;
  loading: boolean;
  /** The Pond answered, and has no timed schedule with this id. */
  missing: boolean;
  /**
   * Why the last read failed, when there is a sentence for it. What a change came to -- saved, a
   * run started, a refusal -- is said in the snackbar instead, and is gone in a few seconds.
   */
  error: string | null;
  /** A read failed before anything loaded, so the schedule is unknown, not missing. */
  failed: boolean;
  /** What the last change did, for a line on screen; cleared by the next one. */
  notice: 'saved' | 'runStarted' | 'missedSkipped' | null;
  runs: UseScheduleRuns;
  actions: {
    refresh: () => Promise<void>;
    /** Reads the run history again, for a history that failed to load. */
    refreshRuns: () => void;
    /** Resolves to why the Pond refused it, or null once saved. An empty change sends nothing. */
    update: (req: UpdateScheduleRequest) => Promise<string | null>;
    setPaused: (paused: boolean) => Promise<void>;
    runNow: () => Promise<void>;
    /** Settles the missed run the Pond is asking about. */
    answerMissed: (answer: 'run' | 'skip') => Promise<void>;
    /** Resolves to true once the Pond no longer has it. */
    remove: () => Promise<boolean>;
  };
}

/** The mock's answer to an edit, shaped as the Pond's would be. */
function applyLocally(schedule: Schedule, req: UpdateScheduleRequest): Schedule {
  const next: Schedule = { ...schedule };
  if (req.name != null) next.label = req.name;
  if (req.timezone != null) next.timezone = req.timezone;
  if (req.prompt != null) next.kind = { type: 'agent_prompt', prompt: req.prompt };
  if (req.fire_at != null) {
    next.fire_at = req.fire_at;
    next.cron = '@once';
  } else if (req.cron != null) {
    next.cron = req.cron;
    next.fire_at = null;
  }
  return next;
}

export function useScheduleDetail(id: string): UseScheduleDetail {
  const { hydrated, isScreenReal } = useServer();
  const real = isScreenReal('schedule');
  const sample = () => SAMPLE_SCHEDULES.find((s) => s.id === id) ?? null;

  const [schedule, setSchedule] = useState<Schedule | null>(() => (real ? null : sample()));
  const [loading, setLoading] = useState(real);
  const [missing, setMissing] = useState(() => !real && sample() == null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<UseScheduleDetail['notice']>(null);
  const [runsVersion, setRunsVersion] = useState(0);

  // The Developer toggle, or another id, swaps what is shown; reset while rendering, as useSchedules does.
  const [source, setSource] = useState({ real, id });
  if (source.real !== real || source.id !== id) {
    setSource({ real, id });
    setSchedule(real ? null : sample());
    setLoading(real);
    setMissing(!real && sample() == null);
    setError(null);
    setFailed(false);
  }

  // Bumped by every change made here, so a read that began before one does not put the old copy back.
  const changes = useRef(0);
  const loaded = useRef(false);
  const scheduleRef = useRef(schedule);
  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  const load = useCallback(
    async (loud: boolean) => {
      if (!real) return;
      if (loud) {
        setLoading(true);
        setError(null);
      }
      const startedAt = changes.current;
      try {
        const list = await api.listSchedules();
        const found = list.find((s) => s.id === id && !isRule(s)) ?? null;
        if (startedAt === changes.current) {
          const before = scheduleRef.current;
          // A run that finished while this was open has a new row in the history.
          if (before?.currently_running && found && !found.currently_running) setRunsVersion((v) => v + 1);
          setSchedule(found);
          setMissing(found == null);
        }
        loaded.current = true;
        setFailed(false);
      } catch (e) {
        if (loud || !loaded.current) setError(describeScheduleError(e));
        else console.warn('[schedule-detail] refresh failed; showing the last result', e instanceof ApiError ? e.status : 'network');
        if (!loaded.current) setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [real, id],
  );

  const refresh = useCallback(() => load(true), [load]);
  const refreshRuns = useCallback(() => setRunsVersion((v) => v + 1), []);

  const delay = useCallback(
    () => (scheduleRef.current?.currently_running ? SCHEDULES_ACTIVE_MS : SCHEDULES_IDLE_MS),
    [],
  );
  useLive(() => load(false), delay, hydrated && real);

  const runs = useScheduleRuns(schedule ? id : null, runsVersion);

  const update = useCallback(
    async (req: UpdateScheduleRequest) => {
      const current = scheduleRef.current;
      if (!current) return i18n.t('schedule.errors.gone');
      if (Object.keys(req).length === 0) return null;
      if (!real) {
        changes.current += 1;
        setSchedule(applyLocally(current, req));
        showSnackbar({ message: i18n.t('schedule.detail.saved') });
        return null;
      }
      try {
        const saved = await api.updateSchedule(id, req);
        changes.current += 1;
        setSchedule(saved);
        showSnackbar({ message: i18n.t('schedule.detail.saved') });
        return null;
      } catch (e) {
        console.warn('[schedule-detail] update refused', e instanceof ApiError ? e.status : 'network');
        return describeScheduleError(e) ?? i18n.t('schedule.errors.saveFailed');
      }
    },
    [real, id],
  );

  // What a snackbar's Try again calls: the current pause and run-now, set once each is made below.
  const retry = useRef<{ setPaused: (paused: boolean) => Promise<void>; runNow: () => Promise<void> }>({
    setPaused: async () => {},
    runNow: async () => {},
  });

  /** Optimistic, and put back if the Pond refuses, as on the list. */
  const setPaused = useCallback(
    async (paused: boolean) => {
      const current = scheduleRef.current;
      if (!current) return;
      changes.current += 1;
      setSchedule({ ...current, paused });
      if (!real) return;
      try {
        await (paused ? api.pauseSchedule(id) : api.resumeSchedule(id));
        // `next_run` moved with it; the Pond's answer to pause and resume does not carry it.
        void load(false);
      } catch (e) {
        changes.current += 1;
        setSchedule((s) => (s ? { ...s, paused: current.paused } : s));
        console.warn('[schedule-detail] pause refused', e instanceof ApiError ? e.status : 'network');
        showSnackbar({
          message: describeScheduleError(e) ?? i18n.t('schedule.errors.saveFailed'),
          tone: 'danger',
          action: { label: i18n.t('common.retry'), onPress: () => void retry.current.setPaused(paused) },
        });
      }
    },
    [real, id, load],
  );


  // A run-now not yet answered; the Pond starts a run for every request, so a second tap would start a second.
  const starting = useRef(false);
  const runNow = useCallback(async () => {
    const current = scheduleRef.current;
    if (!real || !current || starting.current) return;
    starting.current = true;
    changes.current += 1;
    setSchedule({ ...current, currently_running: true });
    try {
      await api.runScheduleNow(id);
      changes.current += 1;
      showSnackbar({ message: i18n.t('schedule.detail.runStarted') });
    } catch (e) {
      changes.current += 1;
      setSchedule((s) => (s ? { ...s, currently_running: current.currently_running } : s));
      console.warn('[schedule-detail] run now refused', e instanceof ApiError ? e.status : 'network');
      showSnackbar({
        message: describeScheduleError(e) ?? i18n.t('schedule.errors.saveFailed'),
        tone: 'danger',
        action: { label: i18n.t('common.retry'), onPress: () => void retry.current.runNow() },
      });
    } finally {
      starting.current = false;
    }
  }, [real, id]);

  // An answer not yet settled; the first answer from any phone settles it, so a second tap is moot.
  const answering = useRef(false);
  const answerMissed = useCallback(
    async (answer: 'run' | 'skip') => {
      if (!real || answering.current) return;
      answering.current = true;
      setNotice(null);
      setError(null);
      try {
        await api.answerMissedRun(id, answer);
        setNotice(answer === 'run' ? 'runStarted' : 'missedSkipped');
      } catch (e) {
        // A 409 is another phone answering first: not a failure, and the read below shows what it chose.
        setError(
          e instanceof ApiError && e.status === 409
            ? i18n.t('schedule.missed.answered')
            : describeScheduleError(e) ?? i18n.t('schedule.errors.saveFailed'),
        );
      } finally {
        answering.current = false;
      }
      changes.current += 1;
      setRunsVersion((v) => v + 1);
      await load(false);
    },
    [real, id, load],
  );
  useEffect(() => {
    retry.current = { setPaused, runNow };
  }, [setPaused, runNow]);

  const remove = useCallback(async () => {
    if (!real) {
      changes.current += 1;
      setSchedule(null);
      setMissing(true);
      return true;
    }
    try {
      await api.deleteSchedule(id);
      changes.current += 1;
      setSchedule(null);
      setMissing(true);
      return true;
    } catch (e) {
      // Already gone is what was asked for.
      if (e instanceof ApiError && e.status === 404) return true;
      console.warn('[schedule-detail] delete refused', e instanceof ApiError ? e.status : 'network');
      // No Try again: the button is still on screen, and a delete goes through its question again.
      showSnackbar({ message: describeScheduleError(e) ?? i18n.t('schedule.errors.deleteFailed'), tone: 'danger' });
      return false;
    }
  }, [real, id]);

  return {
    schedule,
    loading,
    missing,
    error,
    failed,
    runs,
    notice,
    actions: { refresh, refreshRuns, update, setPaused, runNow, answerMissed, remove },
  };
}
