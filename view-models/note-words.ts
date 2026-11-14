// What a message's note says in words: where the message came from, and what it set.

import type { IconName } from '@/constants/icons';
import type { NoteFrom, OfferState, Receipt } from '@/models/message-note';
import i18n from '@/services/i18n';

/** The quiet line above a message the Pond wrote for itself. */
export function fromWords(from: NoteFrom): string {
  const label = from.label;
  switch (from.kind) {
    case 'schedule':
      return label ? i18n.t('chat.note.from.schedule', { label }) : i18n.t('chat.note.from.scheduleBare');
    case 'reminder':
      return label ? i18n.t('chat.note.from.reminderNamed', { label }) : i18n.t('chat.note.from.reminder');
    case 'task':
      return label ? i18n.t('chat.note.from.task', { label }) : i18n.t('chat.note.from.taskBare');
    case 'lookup':
      return label ? i18n.t('chat.note.from.lookup', { label }) : i18n.t('chat.note.from.lookupBare');
    case 'watch':
      return label ? i18n.t('chat.note.from.watch', { label }) : i18n.t('chat.note.from.watchBare');
    case 'heartbeat':
      return label ? i18n.t('chat.note.from.heartbeat', { label }) : i18n.t('chat.note.from.heartbeatBare');
    case 'suggestion':
      return i18n.t('chat.note.from.suggestion');
    default:
      return label;
  }
}

export function fromIcon(kind: NoteFrom['kind']): IconName {
  switch (kind) {
    case 'schedule':
      return 'calendar-clock';
    case 'reminder':
      return 'bell';
    case 'task':
      return 'checklist';
    case 'lookup':
      return 'search';
    case 'watch':
      return 'eye';
    case 'suggestion':
      return 'light';
    default:
      return 'sparkle';
  }
}

/** A receipt's one line: what was set, or what was not. */
export function receiptWords(receipt: Receipt): string {
  return receipt.outcome === 'set'
    ? i18n.t('chat.note.receipt.set', { what: receipt.what })
    : i18n.t('chat.note.receipt.notSet', { what: receipt.what });
}

/** How an answered offer reads; null while it is still open. */
export function offerStateWords(state: OfferState): string | null {
  if (state === 'done') return i18n.t('chat.note.offer.done');
  if (state === 'dismissed') return i18n.t('chat.note.offer.dismissed');
  return null;
}
