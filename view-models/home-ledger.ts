/**
 * Home's "Right now": what is true about the house at this moment, one line each.
 *
 * It replaced two tall cards and two badges that between them said four things in a third of the
 * screen. A line is drawn only when there is a fact behind it, so the order here is the order on
 * screen and an absent fact leaves no gap. Pure, so what each line says is tested without a Pond.
 */

import i18n from '@/services/i18n';
import type { HomeReminders } from './use-home-ideas';
import { untilOf, type NextRoutine, type NowPlaying, type Outdoor } from './use-right-now';

export type LedgerKind = 'playing' | 'next' | 'devices' | 'outside' | 'remember';

export interface LedgerEntry {
  kind: LedgerKind;
  value: string;
  /** Said at the line's end, quieter: a countdown, a count. */
  detail: string | null;
}

export interface LedgerFacts {
  nowPlaying: NowPlaying | null;
  nextRoutine: NextRoutine | null;
  now: Date;
  /** Null while the list is loading or failed, so a count is never stated about an unknown list. */
  devices: { online: number; total: number } | null;
  outdoor: Outdoor | null;
  reminders: HomeReminders | null;
}

export function untilText(at: Date, now: Date): string {
  const until = untilOf(at, now);
  if (until.unit === 'now') return i18n.t('home.dueNow');
  if (until.unit === 'minutes') return i18n.t('home.inMinutes', { count: until.count });
  if (until.unit === 'hours') return i18n.t('home.inHours', { count: until.count });
  return i18n.t('home.inDays', { count: until.count });
}

export function homeLedger(facts: LedgerFacts): LedgerEntry[] {
  const lines: LedgerEntry[] = [];

  // Silence is not news on a glance: "Nothing playing" took half a row to say it.
  if (facts.nowPlaying?.state === 'playing') {
    const { track, artist } = facts.nowPlaying;
    lines.push({
      kind: 'playing',
      value: artist ? i18n.t('home.ledger.playingBy', { track, artist }) : track,
      detail: null,
    });
  }

  if (facts.nextRoutine) {
    const { label, nextRun } = facts.nextRoutine;
    lines.push({
      kind: 'next',
      value: i18n.t('home.ledger.routineAt', {
        label,
        time: nextRun.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      }),
      detail: untilText(nextRun, facts.now),
    });
  }

  if (facts.devices && facts.devices.total > 0) {
    lines.push({
      kind: 'devices',
      value: i18n.t('home.ledger.devicesOnline', { online: facts.devices.online, total: facts.devices.total }),
      detail: null,
    });
  }

  if (facts.outdoor) {
    const temp = Math.round(facts.outdoor.temp);
    lines.push({
      kind: 'outside',
      value: facts.outdoor.place
        ? i18n.t('home.ledger.outsideIn', { temp, place: facts.outdoor.place })
        : i18n.t('home.ledger.outside', { temp }),
      detail: null,
    });
  }

  if (facts.reminders) {
    lines.push({
      kind: 'remember',
      value: facts.reminders.first.text,
      detail: facts.reminders.more > 0 ? i18n.t('home.ledger.more', { count: facts.reminders.more }) : null,
    });
  }

  return lines;
}
