// My Pond's ids in a household's words. Each is an exhaustive switch, so a new id fails to compile
// here rather than shipping as a raw word on screen.

import type { InkTone } from '@jarida/ink';

import type { TileColor } from '@/constants/colors';
import type { IconName } from '@/constants/icons';
import { checkReading, healthSummary, isTaskFinished, percentOf, type AreaGroupId } from '@/models/pond-admin';
import i18n from '@/services/i18n';
import type { AdminCacheId, AdminCheckId, AdminCheckStatus, AdminHealth, AdminKeepReason, AdminReliability, AdminTask, LongTaskState } from '@/services/types';
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

/** One line of the reliability report: what was counted, and how it came out. */
export interface ReliabilityRow {
  key: string;
  label: string;
  value: string;
  /** Something that keeps notices from arriving or messages from being answered. */
  warn?: boolean;
}

export interface ReliabilitySection {
  key: 'notices' | 'messages' | 'phones' | 'pond';
  title: string;
  rows: ReliabilityRow[];
}

/** "9 of 20 (45%)", or the part alone when there is no whole to be a share of. */
export function shareWords(part: number, whole: number): string {
  const percent = percentOf(part, whole);
  return percent === null ? String(part) : i18n.t('myPond.reliability.share', { part, whole, percent });
}

/** The report in plain words, in the order the Pond's own `reliability` command prints it. */
export function reliabilitySections(r: AdminReliability): ReliabilitySection[] {
  const n = r.notices;
  const neverFetched = Math.max(0, n.queued - n.fetched);
  const unanswered = Math.max(0, r.turns.asked - r.turns.answered);
  const key = (present: boolean) => (present ? i18n.t('myPond.reliability.present') : i18n.t('myPond.reliability.missing'));
  return [
    {
      key: 'notices',
      title: i18n.t('myPond.reliability.notices'),
      rows: [
        { key: 'queued', label: i18n.t('myPond.reliability.queued'), value: String(n.queued) },
        { key: 'woken', label: i18n.t('myPond.reliability.woken'), value: String(n.woken) },
        { key: 'fetched', label: i18n.t('myPond.reliability.fetched'), value: shareWords(n.fetched, n.queued) },
        { key: 'withinAMinute', label: i18n.t('myPond.reliability.withinAMinute'), value: shareWords(n.fetched_within_a_minute, n.queued) },
        { key: 'afterAnHour', label: i18n.t('myPond.reliability.afterAnHour'), value: String(n.fetched_after_an_hour) },
        { key: 'neverFetched', label: i18n.t('myPond.reliability.neverFetched'), value: String(neverFetched), warn: neverFetched > 0 },
        { key: 'shown', label: i18n.t('myPond.reliability.shown'), value: String(n.shown) },
        { key: 'opened', label: i18n.t('myPond.reliability.opened'), value: String(n.opened) },
        { key: 'spoken', label: i18n.t('myPond.reliability.spoken'), value: String(n.spoken) },
      ],
    },
    {
      key: 'messages',
      title: i18n.t('myPond.reliability.messages'),
      rows: [
        { key: 'asked', label: i18n.t('myPond.reliability.asked'), value: String(r.turns.asked) },
        { key: 'answered', label: i18n.t('myPond.reliability.answered'), value: shareWords(r.turns.answered, r.turns.asked) },
        { key: 'unanswered', label: i18n.t('myPond.reliability.unanswered'), value: String(unanswered), warn: unanswered > 0 },
      ],
    },
    {
      key: 'phones',
      title: i18n.t('myPond.reliability.phones'),
      rows: [
        { key: 'paired', label: i18n.t('myPond.reliability.paired'), value: String(r.phones.paired) },
        { key: 'withPush', label: i18n.t('myPond.reliability.withPush'), value: shareWords(r.phones.with_push_token, r.phones.paired) },
        { key: 'unseen', label: i18n.t('myPond.reliability.unseen'), value: String(r.phones.unseen) },
        ...(r.phones.test > 0 ? [{ key: 'test', label: i18n.t('myPond.reliability.test'), value: String(r.phones.test) }] : []),
      ],
    },
    {
      key: 'pond',
      title: i18n.t('myPond.reliability.pond'),
      rows: [
        { key: 'stops', label: i18n.t('myPond.reliability.stops'), value: String(r.stops) },
        { key: 'androidKey', label: i18n.t('myPond.reliability.androidKey'), value: key(r.android_push_key), warn: !r.android_push_key },
        { key: 'appleKey', label: i18n.t('myPond.reliability.appleKey'), value: key(r.apple_push_key), warn: !r.apple_push_key },
      ],
    },
  ];
}
