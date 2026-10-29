// My Pond's ids in a household's words. Each is an exhaustive switch, so a new id fails to compile
// here rather than shipping as a raw word on screen.

import type { IconName } from '@/constants/icons';
import i18n from '@/services/i18n';
import type { AdminAreaId, AdminCacheId, AdminCheckId, AdminCheckStatus, AdminKeepReason, LongTaskState } from '@/services/types';
import { taskStateLabel } from './long-task-words';

export function areaLabel(id: AdminAreaId): string {
  switch (id) {
    case 'models':
      return i18n.t('myPond.area.models');
    case 'conversations':
      return i18n.t('myPond.area.conversations');
    case 'kv_snapshots':
      return i18n.t('myPond.area.kvSnapshots');
    case 'engine_caches':
      return i18n.t('myPond.area.engineCaches');
    case 'attachments':
      return i18n.t('myPond.area.attachments');
    case 'camera':
      return i18n.t('myPond.area.camera');
    case 'logs':
      return i18n.t('myPond.area.logs');
    case 'other':
      return i18n.t('myPond.area.other');
  }
}

export function cacheLabel(id: AdminCacheId): string {
  switch (id) {
    case 'kv_snapshots':
      return i18n.t('myPond.caches.kvSnapshots');
    case 'download_leftovers':
      return i18n.t('myPond.caches.downloadLeftovers');
    case 'accelerator_caches':
      return i18n.t('myPond.caches.acceleratorCaches');
  }
}

/** What clearing a cache costs, said before it is cleared. */
export function cacheEffect(id: AdminCacheId): string {
  switch (id) {
    case 'kv_snapshots':
      return i18n.t('myPond.caches.kvSnapshotsEffect');
    case 'download_leftovers':
      return i18n.t('myPond.caches.downloadLeftoversEffect');
    case 'accelerator_caches':
      return i18n.t('myPond.caches.acceleratorCachesEffect');
  }
}

export function checkLabel(id: AdminCheckId): string {
  switch (id) {
    case 'disk_space':
      return i18n.t('myPond.health.check.disk');
    case 'memory':
      return i18n.t('myPond.health.check.memory');
    case 'temperature':
      return i18n.t('myPond.health.check.temperature');
    case 'other':
      return i18n.t('myPond.health.check.other');
  }
}

export function checkStatusLabel(status: AdminCheckStatus): string {
  switch (status) {
    case 'ok':
      return i18n.t('myPond.health.status.ok');
    case 'warning':
      return i18n.t('myPond.health.status.warning');
    case 'critical':
      return i18n.t('myPond.health.status.critical');
  }
}

export function checkStatusIcon(status: AdminCheckStatus): IconName {
  return status === 'ok' ? 'check' : 'warn';
}

/** Why an entry stays: the Pond is using it, or Models is the way to remove it. */
export function keepReasonWords(reason: AdminKeepReason): string {
  switch (reason) {
    case 'in_use':
      return i18n.t('myPond.files.inUse');
    case 'managed_by_models':
      return i18n.t('myPond.files.managedByModels');
    case 'protected':
      return i18n.t('myPond.files.protected');
  }
}

/** A thermal zone by what it measures; a zone this phone does not know keeps the board's own name. */
export function zoneLabel(zone: string): string {
  const z = zone.toLowerCase();
  if (z.startsWith('cpu')) return i18n.t('myPond.health.zone.cpu');
  if (z.startsWith('gpu')) return i18n.t('myPond.health.zone.gpu');
  if (z.startsWith('soc')) return i18n.t('myPond.health.zone.soc');
  if (z === 'tj' || z.startsWith('tj-')) return i18n.t('myPond.health.zone.junction');
  return zone;
}

/** A task's state, or a plain word for one this phone does not know. */
export function adminTaskState(state: LongTaskState | null): string {
  return state === null ? i18n.t('myPond.tasks.unknownState') : taskStateLabel(state);
}

/** Seconds as the largest units that matter: "3 d 4 h", "2 h 5 min", "40 s". */
export function durationWords(secs: number | null): string | null {
  if (secs === null) return null;
  const s = Math.floor(secs);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  if (days > 0) return i18n.t('myPond.duration.daysHours', { days, hours });
  if (hours > 0) return i18n.t('myPond.duration.hoursMinutes', { hours, minutes });
  if (minutes > 0) return i18n.t('myPond.duration.minutes', { minutes });
  return i18n.t('myPond.duration.seconds', { seconds: s });
}

/** A time the Pond sent, as the phone's own date and time, or null when it sent none. */
export function whenWords(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  return at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** What a task saved, by the Pond's artifact kinds; a kind this phone does not know is a saved piece. */
export function artifactKindLabel(kind: string): string {
  switch (kind) {
    case 'note':
      return i18n.t('myPond.tasks.kind.note');
    case 'findings':
      return i18n.t('myPond.tasks.kind.findings');
    case 'draft':
      return i18n.t('myPond.tasks.kind.draft');
    case 'data':
      return i18n.t('myPond.tasks.kind.data');
    default:
      return i18n.t('myPond.tasks.kind.other');
  }
}
