// My Pond's ids in a household's words. Each is an exhaustive switch, so a new id fails to compile
// here rather than shipping as a raw word on screen.

import type { InkTone } from '@jarida/ink';

import type { TileColor } from '@/constants/colors';
import type { IconName } from '@/constants/icons';
import { checkReading, healthSummary, isTaskFinished, type AreaGroupId } from '@/models/pond-admin';
import i18n from '@/services/i18n';
import type { AdminCacheId, AdminCheckId, AdminCheckStatus, AdminHealth, AdminKeepReason, AdminTask, LongTaskState } from '@/services/types';
import { taskStateLabel } from './long-task-words';
import { calendarDaysBetween } from './use-chat-history';

export function areaGroupLabel(id: AreaGroupId): string {
  switch (id) {
    case 'models':
      return i18n.t('myPond.areaGroup.models');
    case 'engine_caches':
      return i18n.t('myPond.areaGroup.engineCaches');
    case 'kv_snapshots':
      return i18n.t('myPond.areaGroup.kvSnapshots');
    case 'rest':
      return i18n.t('myPond.areaGroup.rest');
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

/** What a cache is and what clearing it costs, said before it is cleared. */
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

export function cacheIcon(id: AdminCacheId): IconName {
  switch (id) {
    case 'kv_snapshots':
      return 'bolt';
    case 'download_leftovers':
      return 'download';
    case 'accelerator_caches':
      return 'cpu';
  }
}

export function cacheTile(id: AdminCacheId): TileColor {
  switch (id) {
    case 'kv_snapshots':
      return 'blue';
    case 'download_leftovers':
      return 'slate';
    case 'accelerator_caches':
      return 'teal';
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

export function checkTone(status: AdminCheckStatus): InkTone {
  switch (status) {
    case 'ok':
      return 'success';
    case 'warning':
      return 'warning';
    case 'critical':
      return 'danger';
  }
}

/** When the Pond warns, as its own checks are set; null for a check this phone does not know. */
export function checkThreshold(id: AdminCheckId): string | null {
  switch (id) {
    case 'disk_space':
      return i18n.t('myPond.health.threshold.disk');
    case 'memory':
      return i18n.t('myPond.health.threshold.memory');
    case 'temperature':
      return i18n.t('myPond.health.threshold.temperature');
    case 'other':
      return null;
  }
}

/** The reading a check stands on, or its status when there is nothing to read it from. */
export function checkValueWords(health: AdminHealth, id: AdminCheckId, status: AdminCheckStatus): string {
  const reading = checkReading(health, id);
  if (reading === null) return checkStatusLabel(status);
  // Rounded down, so a disk that warns at 9.6% free never reads as the 10% it is warned under.
  const shown = Math.floor(reading);
  switch (id) {
    case 'disk_space':
      return i18n.t('myPond.health.value.diskFree', { percent: shown });
    case 'memory':
      return i18n.t('myPond.health.value.memoryAvailable', { percent: shown });
    case 'temperature':
      return i18n.t('myPond.health.celsius', { value: shown });
    case 'other':
      return checkStatusLabel(status);
  }
}

/** The top of Health: all good, or which checks need a look and how badly. */
export function healthSummaryWords(health: AdminHealth): { status: AdminCheckStatus; title: string; line: string } {
  const { status, notOk } = healthSummary(health);
  if (status === 'ok') return { status, title: i18n.t('myPond.health.allGood'), line: i18n.t('myPond.health.allGoodLine') };
  return {
    status,
    title: i18n.t('myPond.health.attention'),
    line: i18n.t('myPond.health.outOfRange', { names: notOk.map(checkLabel).join(i18n.t('myPond.dot')) }),
  };
}

/** Why an entry stays, for a refusal: the Pond is using it, or Models is the way to remove it. */
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

/** Why an entry stays, as the line under its name. */
export function keptLine(reason: AdminKeepReason): string {
  switch (reason) {
    case 'managed_by_models':
      return i18n.t('myPond.files.keptModels');
    case 'in_use':
    case 'protected':
      return i18n.t('myPond.files.keptRuns');
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

/** Ended well, ended badly, still going, or set aside. */
export function taskStateTone(state: LongTaskState | null): InkTone {
  switch (state) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'planning':
    case 'running':
    case 'awaiting_approval':
      return 'warning';
    case 'paused':
    case 'cancelled':
    case null:
      return 'neutral';
  }
}

export function taskKindLabel(task: Pick<AdminTask, 'kind'>): string {
  return task.kind === 'research' ? i18n.t('myPond.tasks.kindResearch') : i18n.t('myPond.tasks.kindTask');
}

/** A day as "28 Oct", with the year once it is not this one. */
export function dayWords(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  return at.getFullYear() === now.getFullYear()
    ? at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "today 12:05", "yesterday 18:40", else the day and the time. */
export function dayAndTime(iso: string | null, now: Date): string | null {
  const date = dayWords(iso, now);
  if (!iso || !date) return null;
  const at = new Date(iso);
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const days = calendarDaysBetween(at, now);
  if (days === 0) return i18n.t('myPond.when.today', { time });
  if (days === 1) return i18n.t('myPond.when.yesterday', { time });
  return i18n.t('myPond.when.dateTime', { date, time });
}

/** A task's line under its goal: when it started or ended, and how much it has saved. */
export function taskMetaWords(task: AdminTask, now: Date): string {
  const finished = isTaskFinished(task.state);
  const at = dayAndTime(finished ? task.finished_at : task.created_at, now);
  let when: string | null = null;
  if (at && !finished) when = i18n.t('myPond.tasks.startedAt', { when: at });
  else if (at && task.state === 'cancelled') when = i18n.t('myPond.tasks.stoppedAt', { when: at });
  else if (at && task.state === 'failed') when = i18n.t('myPond.tasks.endedAt', { when: at });
  else if (at) when = i18n.t('myPond.tasks.finishedAt', { when: at });
  const saved = finished
    ? i18n.t('myPond.tasks.artifactsCount', { count: task.artifacts.length })
    : i18n.t('myPond.tasks.artifactsSoFar', { count: task.artifacts.length });
  const parts = [when, saved, task.another_member ? i18n.t('myPond.tasks.theirWords') : null];
  return parts.filter((p): p is string => !!p).join(i18n.t('myPond.dot'));
}

/** Seconds as the largest two units that matter: "1 day 19 hours", "2 hours 5 minutes", "40 seconds". */
export function durationWords(secs: number | null): string | null {
  if (secs === null) return null;
  const s = Math.floor(secs);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const pair = (a: string, b: string) => i18n.t('myPond.duration.pair', { a, b });
  if (days > 0) return pair(i18n.t('myPond.duration.days', { count: days }), i18n.t('myPond.duration.hours', { count: hours }));
  if (hours > 0) return pair(i18n.t('myPond.duration.hours', { count: hours }), i18n.t('myPond.duration.minutes', { count: minutes }));
  if (minutes > 0) return i18n.t('myPond.duration.minutes', { count: minutes });
  return i18n.t('myPond.duration.seconds', { count: s });
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

/** A power mode by nvpmodel's name, in what it means for Goose; null for a name this phone does not know. */
export function powerModeWords(name: string): string | null {
  switch (name.toUpperCase()) {
    case '7W':
      return i18n.t('myPond.power.modeWords.w7');
    case '15W':
      return i18n.t('myPond.power.modeWords.w15');
    case '25W':
      return i18n.t('myPond.power.modeWords.w25');
    case 'MAXN_SUPER':
    case 'MAXN':
      return i18n.t('myPond.power.modeWords.maxn');
    default:
      return null;
  }
}
