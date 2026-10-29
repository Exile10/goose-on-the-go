// Every My Pond route goes through here, so the Developer toggle can swap in the mock Pond.

import { createMockPond, type PondAdminSource } from '@/models/pond-admin-mock';
import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';

export type { PondAdminSource } from '@/models/pond-admin-mock';

/** Calls `api` at call time, so a test's mock of the client is the one used. */
export const POND_ADMIN: PondAdminSource = {
  status: () => api.adminStatus(),
  unlock: (password) => api.adminUnlock(password),
  lock: () => api.adminLock(),
  overview: () => api.adminOverview(),
  files: (path) => api.adminFiles(path),
  deleteFile: (path) => api.adminDeleteFile(path),
  caches: () => api.adminCaches(),
  clearCache: (id) => api.adminClearCache(id),
  tasks: () => api.adminTasks(),
  deleteTask: (id) => api.adminDeleteTask(id),
  deleteTaskArtifact: (taskId, artifactId) => api.adminDeleteTaskArtifact(taskId, artifactId),
  health: () => api.adminHealth(),
  power: () => api.adminPower(),
  setPowerMode: (id) => api.adminSetPowerMode(id),
  restart: (force) => api.adminRestart(force),
};

// One mock for the whole app, so what is deleted on Files is gone from the overview too.
let mock: PondAdminSource | null = null;

export function mockPondAdmin(): PondAdminSource {
  mock ??= createMockPond();
  return mock;
}

/** For tests: the next `mockPondAdmin()` starts from the samples again. */
export function resetMockPondAdmin(): void {
  mock = null;
}

export function usePondAdminSource(): PondAdminSource {
  const { isScreenReal } = useServer();
  return isScreenReal('pond') ? POND_ADMIN : mockPondAdmin();
}

/** The code in an admin refusal's `error` field, such as `admin_locked`, or null for any other failure. */
export function adminRefusal(e: unknown): string | null {
  return e instanceof ApiError ? e.detail : null;
}

/** How long the Pond asked this phone to wait before trying the card again: the header, else the body. */
export function coolingSeconds(e: unknown): number | null {
  if (!(e instanceof ApiError)) return null;
  if (e.retryAfterSecs !== null) return e.retryAfterSecs;
  const wait = (e.body as { retry_after?: unknown } | null)?.retry_after;
  return typeof wait === 'number' && Number.isFinite(wait) && wait >= 0 ? wait : null;
}
