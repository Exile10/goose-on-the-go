// Ended long tasks and their reports, in memory: an ended task cannot change, so reopening its
// conversation or its report asks the Pond nothing. Dropped on sign-out with the household's data.

import type { LongTask } from './types';

const KEPT = 50;
const tasks = new Map<string, LongTask>();
const reports = new Map<string, unknown>();

function keep<T>(map: Map<string, T>, key: string, value: T): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > KEPT) map.delete(map.keys().next().value as string);
}

export function endedTask(id: string): LongTask | null {
  return tasks.get(id) ?? null;
}

export function keepEndedTask(task: LongTask): void {
  keep(tasks, task.id, task);
}

/** An ended task's report as its screen shows it; the screen owns the shape. */
export function endedReport<T>(id: string): T | null {
  return (reports.get(id) as T | undefined) ?? null;
}

export function keepEndedReport<T>(id: string, report: T): void {
  keep(reports, id, report);
}

export function forgetLongTasks(): void {
  tasks.clear();
  reports.clear();
}
