/**
 * The phone's wake word follows the household's phrase, which lives on the Pond.
 *
 * `installPhoneWake` runs once at launch: it resumes the listening service and answers its speech
 * segments with the Pond (`api.checkWakeSegment`) for as long as the JavaScript runtime lives.
 * `followWakePhrase` hands the service the phrase whenever it is learned, from the Pond's settings
 * (`PhoneWakeSync` in app/_layout.tsx) or from an answer to a segment, so a phrase changed on the
 * dashboard, on this phone or on another reaches the service without a restart of the app.
 */

import { api } from '@/services/api-client';
import i18n from '@/services/i18n';
import {
  answerWakeSegments,
  configurePhoneWake,
  normalizePhrase,
  resumePhoneWake,
  wakeMode,
  type WakeNotificationWords,
} from '@/services/phone-wake';
import type { WakeCheck } from '@/services/types';

/** The phrase the service was last given, as the Pond compares it. */
let followed: string | null = null;

/** The notification's words for `phrase`, in the app's language. */
export function wakeNotificationWords(phrase: string): WakeNotificationWords {
  return {
    title: i18n.t('settings.phoneWake.notification.title', { phrase }),
    body: i18n.t('settings.phoneWake.notification.body', { phrase }),
    stop: i18n.t('settings.phoneWake.notification.stop'),
    channel: i18n.t('settings.phoneWake.notification.channel'),
  };
}

/** Give the service the household's phrase, if it is not the one it already has. */
export function followWakePhrase(phrase: string): void {
  const normalized = normalizePhrase(phrase);
  if (!normalized || normalized === followed) return;
  followed = normalized;
  console.info('[wake] following the household phrase', { kind: 'phone_wake', mode: wakeMode(phrase) });
  configurePhoneWake(phrase, wakeNotificationWords(phrase));
}

async function check(fileUri: string): Promise<WakeCheck | null> {
  try {
    return await api.checkWakeSegment(fileUri);
  } catch (e) {
    console.warn('[wake] the Pond could not check a segment', { kind: 'phone_wake', error: String(e) });
    return null;
  }
}

/** At launch: listening back on if it was chosen, and the Pond answering what it hears. */
export function installPhoneWake(): void {
  void resumePhoneWake();
  answerWakeSegments(check, followWakePhrase);
}
