// Ended long tasks and their results, in memory: an ended task cannot change, so reopening its
// conversation asks the Pond nothing. Dropped on sign-out with the rest of the household's data.

import type { LongTask, LongTaskArtifactBody } from './types';

const KEPT = 50;
const tasks = new Map<string, LongTask>();
const bodies = new Map<string, LongTaskArtifactBody>();

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

export function resultBody(artifactId: string): LongTaskArtifactBody | null {
  return bodies.get(artifactId) ?? null;
}

export function keepResultBody(body: LongTaskArtifactBody): void {
  keep(bodies, body.id, body);
}

export function forgetLongTasks(): void {
  tasks.clear();
  bodies.clear();
}
