// The household's long tasks and what each saved. Another member's task is listed for its size and
// dates, never its goal, which is theirs.

import { useCallback, useState } from 'react';

import { filterTasks, isTaskFinished, leadReport, taskCounts, type TaskFilter } from '@/models/pond-admin';
import { useConfirm } from '@/providers/confirm-provider';
import i18n from '@/services/i18n';
import type { AdminTask, AdminTaskArtifact } from '@/services/types';
import { describeApiError } from './describe-error';
import { adminRefusal } from './pond-admin-source';
import { useAdminGate, useAdminLoad, type AdminGate } from './use-admin-gate';

export interface UsePondTasks {
  gate: AdminGate;
  /** The tasks the filter shows. */
  tasks: AdminTask[];
  filter: TaskFilter;
  /** How many each filter would show. */
  counts: Record<TaskFilter, number>;
  /** The task whose report is the screen's main action, or null. */
  lead: string | null;
  loading: boolean;
  failed: boolean;
  error: string | null;
  notice: string | null;
  /** The task or artifact id being deleted, or null. */
  removing: string | null;
  actions: {
    refresh: () => Promise<void>;
    setFilter: (filter: TaskFilter) => void;
    /** Asks first; resolves to whether it was deleted. */
    removeTask: (task: AdminTask) => Promise<boolean>;
    removeArtifact: (task: AdminTask, artifact: AdminTaskArtifact) => Promise<boolean>;
  };
}

/** The task's own goal, or how another member's task reads. */
export function taskName(task: AdminTask): string {
  if (task.another_member) return i18n.t('myPond.tasks.anotherMember');
  return task.goal ?? i18n.t('myPond.tasks.untitled');
}

function refusalWords(e: unknown): string {
  switch (adminRefusal(e)) {
    case 'task_active':
      return i18n.t('myPond.tasks.active');
    case 'not_found':
      return i18n.t('myPond.tasks.gone');
    default:
      return describeApiError(e) ?? i18n.t('myPond.tasks.deleteFailed');
  }
}

export function usePondTasks(): UsePondTasks {
  const ask = useConfirm();
  const { gate, source, noteFailure, touch } = useAdminGate();
  const [tasks, setTasks] = useState<AdminTask[] | null>(null);
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>('all');

  const read = useCallback(async () => {
    setReading(true);
    try {
      setTasks(await source.tasks());
      setFailed(false);
      touch();
    } catch (e) {
      if (noteFailure(e)) return;
      setFailed(true);
      setError(describeApiError(e) ?? i18n.t('myPond.tasks.readFailed'));
    } finally {
      setReading(false);
    }
  }, [noteFailure, source, touch]);

  useAdminLoad(read, gate);

  const run = useCallback(
    async (id: string, request: () => Promise<void>, done: string) => {
      setRemoving(id);
      setError(null);
      setNotice(null);
      try {
        await request();
        touch();
        setNotice(done);
        await read();
        return true;
      } catch (e) {
        if (noteFailure(e)) return false;
        setError(refusalWords(e));
        if (adminRefusal(e) === 'not_found' || adminRefusal(e) === 'task_active') await read();
        return false;
      } finally {
        setRemoving(null);
      }
    },
    [noteFailure, read, touch],
  );

  const removeTask = useCallback(
    async (task: AdminTask) => {
      if (removing) return false;
      // Offered only once it has ended; said rather than asked if it is reached anyway.
      if (!isTaskFinished(task.state)) {
        setError(i18n.t('myPond.tasks.active'));
        return false;
      }
      const yes = await ask({
        title: i18n.t('myPond.tasks.deleteTitle'),
        message: i18n.t('myPond.tasks.deleteBody', { name: taskName(task), count: task.artifacts.length }),
        confirmLabel: i18n.t('myPond.tasks.deleteTask'),
        cancelLabel: i18n.t('myPond.keepIt'),
        destructive: true,
      });
      if (!yes) return false;
      return run(task.id, () => source.deleteTask(task.id), i18n.t('myPond.tasks.deleted'));
    },
    [ask, removing, run, source],
  );

  const removeArtifact = useCallback(
    async (task: AdminTask, artifact: AdminTaskArtifact) => {
      if (removing) return false;
      if (!isTaskFinished(task.state)) {
        setError(i18n.t('myPond.tasks.active'));
        return false;
      }
      const name = artifact.title ?? i18n.t('myPond.tasks.artifactUntitled');
      const yes = await ask({
        title: i18n.t('myPond.tasks.deleteArtifactTitle', { name }),
        message: i18n.t('myPond.tasks.deleteArtifactBody', { task: taskName(task) }),
        confirmLabel: i18n.t('myPond.tasks.delete'),
        cancelLabel: i18n.t('myPond.keepIt'),
        destructive: true,
      });
      if (!yes) return false;
      return run(artifact.id, () => source.deleteTaskArtifact(task.id, artifact.id), i18n.t('myPond.tasks.artifactDeleted', { name }));
    },
    [ask, removing, run, source],
  );

  const all = tasks ?? [];
  return {
    gate,
    tasks: filterTasks(all, filter),
    filter,
    counts: taskCounts(all),
    lead: leadReport(all),
    loading: reading && tasks === null,
    failed,
    error,
    notice,
    removing,
    actions: { refresh: read, setFilter, removeTask, removeArtifact },
  };
}
