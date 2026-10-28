// The line a waiting task stands in, with a choice for each of the member's own tasks in it: keep it
// going or stop it. Another member's task is only a place in the line, with nothing to choose.

import { useCallback, useMemo, useRef, useState } from 'react';

import { isWaiting, queueChoices, type QueueChoice } from '@/models/long-tasks';
import { ApiError } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { LongTask } from '@/services/types';
import { useLongTasksSource } from './use-long-task';

export interface QueueOutcome {
  stopped: number;
  failures: { goal: string; reason: string }[];
}

export interface UseLongTaskQueue {
  /** Open with another task ahead of it; false at the front, once ended, and on an older Pond. */
  waiting: boolean;
  /** The member's own tasks ahead, then this one; empty when only other members' tasks are ahead. */
  choices: QueueChoice[];
  /** Ids chosen to stop, among the choices still shown. */
  picked: ReadonlySet<string>;
  applying: boolean;
  /** What the last Stop did, until the next choice. */
  outcome: QueueOutcome | null;
  actions: {
    choose: (id: string, stop: boolean) => void;
    /** Stops exactly the picked tasks, then reads this one again. Resolves to whether every one stopped. */
    stopPicked: () => Promise<boolean>;
  };
}

/** Why one task in the line did not stop, in words that fit after its goal. */
export function stopFailureReason(e: unknown): string {
  if (!(e instanceof ApiError)) return i18n.t('chat.longTask.queue.reason.unreachable');
  if (e.status === 404) return i18n.t('chat.longTask.queue.reason.gone');
  if (e.isRetryable) return i18n.t('chat.longTask.queue.reason.busy');
  return i18n.t('chat.longTask.queue.reason.refused');
}

export function useLongTaskQueue(task: LongTask | null, refresh: () => Promise<void>): UseLongTaskQueue {
  const source = useLongTasksSource();
  const [stopIds, setStopIds] = useState<ReadonlySet<string>>(() => new Set());
  const [applying, setApplying] = useState(false);
  const [outcome, setOutcome] = useState<QueueOutcome | null>(null);
  const busy = useRef(false);

  const choices = useMemo(() => (task ? queueChoices(task) : []), [task]);
  // A pick for a task that has since left the line is dropped, so Stop never reaches one not shown.
  const picked = useMemo(() => new Set(choices.filter((c) => stopIds.has(c.id)).map((c) => c.id)), [choices, stopIds]);

  const choose = useCallback((id: string, stop: boolean) => {
    setOutcome(null);
    setStopIds((all) => {
      if (all.has(id) === stop) return all;
      const next = new Set(all);
      if (stop) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const stopPicked = useCallback(async () => {
    const chosen = choices.filter((c) => picked.has(c.id));
    if (busy.current || chosen.length === 0) return false;
    busy.current = true;
    setApplying(true);
    setOutcome(null);
    const failures: QueueOutcome['failures'] = [];
    const failedIds = new Set<string>();
    // One at a time: the Pond rate-limits a phone, and a line is a handful of tasks.
    for (const choice of chosen) {
      try {
        await source.cancel(choice.id);
      } catch (e) {
        // A 409 is a task that had already ended, which is what was asked for.
        if (e instanceof ApiError && e.status === 409) continue;
        console.warn('[long-task] stop from the line failed', { status: e instanceof ApiError ? e.status : 'network' });
        failures.push({ goal: choice.goal, reason: stopFailureReason(e) });
        failedIds.add(choice.id);
      }
    }
    // Only a failed pick stays picked, so Try again is one press.
    setStopIds(failedIds);
    setOutcome({ stopped: chosen.length - failures.length, failures });
    setApplying(false);
    busy.current = false;
    await refresh();
    return failures.length === 0;
  }, [choices, picked, refresh, source]);

  return {
    waiting: task ? isWaiting(task) : false,
    choices,
    picked,
    applying,
    outcome,
    actions: { choose, stopPicked },
  };
}
