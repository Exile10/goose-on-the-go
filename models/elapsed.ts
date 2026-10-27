/**
 * How long ago something happened, in the short words a status line uses:
 * "12 s", "5 min", "3 h". Rounded, because a status line that counts every
 * second reads as alarm rather than information.
 */

import i18n from '@/services/i18n';

export function ago(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return i18n.t('common.ago.seconds', { count: s });
  const minutes = Math.round(s / 60);
  if (minutes < 90) return i18n.t('common.ago.minutes', { count: minutes });
  return i18n.t('common.ago.hours', { count: Math.round(minutes / 60) });
}
