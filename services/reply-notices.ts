/**
 * Telling someone a reply has finished while they were somewhere else.
 *
 * Local rather than the Pond's own push, because the Pond sends nothing when a
 * turn ends. `services/chat-runs.ts` decides when; this decides what it says
 * and whether this phone wants it at all. On unless turned off, and the choice
 * is this phone's, like haptics: it is about its own notification shade.
 */

import i18n from '@/services/i18n';

import { presentLocally } from './local-notifications';
import type { ServerNotification } from './notification-stream';
import { Storage } from './storage';

let enabled = true;

export function replyNoticesEnabled(): boolean {
  return enabled;
}

/** The Settings switch: applies at once and is remembered on this phone. */
export async function saveReplyNoticePreference(next: boolean): Promise<void> {
  enabled = next;
  await Storage.set('replyNotices', next ? '1' : '0').catch(() => undefined);
}

/** Read the remembered choice at launch. Nothing stored means on. */
export async function loadReplyNoticePreference(): Promise<void> {
  const stored = await Storage.get('replyNotices').catch(() => null);
  if (stored !== null) enabled = stored !== '0';
}

/** A turn that ended while nobody was reading it. */
export interface TurnNotice {
  kind: 'answered' | 'failed';
  sessionId: string;
  /** One notice per run, so the same end arriving twice replaces itself. */
  runId: string;
  /** What the conversation is called, when it has a name yet. */
  title: string | null;
  /** The answer, for `answered`. */
  text?: string;
}

/** As much of a reply as reads at a glance in a notification. */
const EXCERPT_CHARS = 140;

/** A reply's opening, as plain words: the shade draws markdown as the characters it is made of. */
export function excerpt(markdown: string): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/\*\*|__|`|\|/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(plain);
  if (chars.length <= EXCERPT_CHARS) return plain;
  return `${chars.slice(0, EXCERPT_CHARS).join('').trimEnd()}…`;
}

/** The notice as the shade shows it, opening the conversation when tapped. */
export function noticeFor(notice: TurnNotice, now = new Date()): ServerNotification {
  const t = i18n.t.bind(i18n);
  const failed = notice.kind === 'failed';
  const title = notice.title?.trim() || t(failed ? 'chat.notice.failedTitle' : 'chat.notice.answeredTitle');
  const body = failed ? t('chat.notice.failedBody') : excerpt(notice.text ?? '') || t('chat.notice.answeredBody');
  return {
    id: `reply-${notice.runId}`,
    target: 'local',
    category: 'reply',
    title,
    body,
    timestamp: now.toISOString(),
    data: { open: 'conversation', session_id: notice.sessionId },
  };
}

export async function announceTurn(notice: TurnNotice): Promise<void> {
  if (!enabled) return;
  await presentLocally(noticeFor(notice));
}
