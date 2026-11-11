/**
 * "Hey Goose" on the phone, on Android: the app listens for the phrase itself and opens the
 * assistant's voice orb (docs/ASSISTANT.md).
 *
 * The native half is `plugins/pond-wake/PondWake.kt`: a microphone foreground service running the
 * Pond's own detector (`native/pondear`, from the Pond's pond-ear crate). This is the JavaScript
 * side of its module, `PondWake`.
 *
 * The phrase is the household's, set on the Pond. For "hey goose" the phone's own detector hears
 * it. For any other phrase the service cuts what it hears into speech segments and this file sends
 * each to the Pond (`POST /voice/wake/check`), which matches it with the pronunciations it has
 * learned; the Pond's answer names the phrase, so a change made there reaches the phone with the
 * next segment, and `usePhoneWakeSync` carries one made while the app is open.
 *
 * Every call is safe anywhere: on iOS, which lets no app listen in the background this way, on an
 * Android build without the plugin, or on a CPU without the detector, `phoneWakeSupported()` is
 * false and the rest do nothing.
 */

import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

import { WAKE_PRESETS } from '@/models/owner-setup';

import type { WakeCheck } from './types';

/** Why the service last stopped without being asked to (GooseWakeService's REFUSED_* values). */
export type WakeRefusal = 'start_refused' | 'no_microphone' | 'model_failed' | 'not_assistant';

export interface PhoneWakeState {
  /** The person's choice, kept across launches. */
  chosen: boolean;
  /** Whether the service is running now. It listens only while the phone is unlocked and no
   * screen of the app is in front. */
  active: boolean;
  refusal: WakeRefusal | null;
}

/** The notification's words, from the app's translations; the service keeps them for restarts. */
export interface WakeNotificationWords {
  title: string;
  body: string;
  stop: string;
  channel: string;
}

/** How the service listens: its own detector for "hey goose", the Pond's for anything else. */
export type WakeMode = 'hey_goose' | 'pond';

interface WakeBridge {
  available(): boolean;
  configure(mode: WakeMode, words: WakeNotificationWords): void;
  done(path: string): void;
  heard(): Promise<boolean>;
  state(): Promise<PhoneWakeState>;
  choose(on: boolean, words: WakeNotificationWords | Record<string, never>): Promise<boolean>;
  resume(): Promise<boolean>;
  voices(): Promise<PhoneVoices>;
  installSpeakerModel(uri: string): Promise<boolean>;
  enrolTake(uri: string, profileId: string): Promise<{ peak: number; takes: number }>;
  forgetVoice(profileId: string): Promise<null>;
  chooseWakeThreshold(cnn: number): Promise<null>;
  testWake(uri: string): Promise<WakeTestRun>;
}

/** What the wake word's voice check knows on this phone (`WakeVoices` in PondWake.kt). */
export interface PhoneVoices {
  /** Whether the Pond's speaker model is here. */
  model: boolean;
  /** Who is taught on this phone, and with how many takes. Only they can wake it once anyone is. */
  people: { profileId: string; takes: number }[];
  /** The CNN's line for "hey goose": the takes' own, or one a wake test chose. */
  cnn: number;
  /** A voice at or above `accept` is taken as taught; below `reject` it is ignored. */
  accept: number;
  reject: number;
  /** The range the CNN's line stays in. */
  floor: number;
  strict: number;
  /** Whether a wake test chose the CNN's line. */
  chosen: boolean;
}

/** What the service would do with a candidate: "below" is one it would not have heard at all. */
export type WakeTestDecision = 'below' | 'ignore' | 'wake' | 'ask_pond';

export interface WakeTestCandidate {
  /** Seconds into the recording. */
  t: number;
  /** The CNN's peak probability. */
  p: number;
  /** The best match among the taught voices; null when nothing was scored. */
  voice: number | null;
  decision: WakeTestDecision;
  /** For "ask_pond": the speech, as a WAV in the cache, to send to the Pond and then delete. */
  segment: string | null;
}

export interface WakeTestRun {
  cnn: number;
  taught: boolean;
  candidates: WakeTestCandidate[];
}

/** The module; null off Android or without the plugin. The voice check's calls use it too. */
export function wakeBridge(): WakeBridge | null {
  if (Platform.OS !== 'android') return null;
  return (NativeModules.PondWake as WakeBridge | undefined) ?? null;
}

/** Whether this build, CPU and Android version can listen for "Hey Goose". */
export function phoneWakeSupported(): boolean {
  const native = wakeBridge();
  if (!native) return false;
  try {
    return native.available();
  } catch (e) {
    console.warn('[wake] could not ask whether the detector loads', { kind: 'phone_wake', error: String(e) });
    return false;
  }
}

/** What the switch and the service are doing; null where that cannot be known. */
export async function phoneWakeState(): Promise<PhoneWakeState | null> {
  const native = wakeBridge();
  if (!native) return null;
  try {
    return await native.state();
  } catch (e) {
    console.warn('[wake] could not read the wake word state', { kind: 'phone_wake', error: String(e) });
    return null;
  }
}

/**
 * Turn listening on (with the notification's words) or off. Resolves whether Android accepted it:
 * false when the start was refused, which the state's `refusal` then explains.
 */
export async function choosePhoneWake(on: boolean, words: WakeNotificationWords): Promise<boolean> {
  const native = wakeBridge();
  if (!native) return false;
  try {
    const accepted = await native.choose(on, on ? words : {});
    console.info('[wake] listening chosen', { kind: 'phone_wake', on, accepted });
    return accepted;
  } catch (e) {
    console.warn('[wake] could not change the wake word', { kind: 'phone_wake', on, error: String(e) });
    return false;
  }
}

/**
 * At launch: start listening again if it was chosen. Android only lets the service start while the
 * app is in front, so a reboot or a force stop ends it until the app next opens.
 */
export async function resumePhoneWake(): Promise<void> {
  const native = wakeBridge();
  if (!native) return;
  try {
    await native.resume();
  } catch (e) {
    console.warn('[wake] could not resume listening', { kind: 'phone_wake', error: String(e) });
  }
}

/** The phrase as the Pond compares it (`normalize_transcript`): lower case, words only. */
export function normalizePhrase(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The one phrase the phone's own detector (and the Pond's) was trained on: the first preset. */
export const CNN_PHRASE = WAKE_PRESETS[0];

/** Which way the phone listens for `phrase`. */
export function wakeMode(phrase: string): WakeMode {
  return normalizePhrase(phrase) === CNN_PHRASE ? 'hey_goose' : 'pond';
}

/** Tell the service the household's phrase, with the notification's words that name it. */
export function configurePhoneWake(phrase: string, words: WakeNotificationWords): void {
  const native = wakeBridge();
  if (!native) return;
  try {
    native.configure(wakeMode(phrase), words);
  } catch (e) {
    console.warn('[wake] could not set the wake phrase', { kind: 'phone_wake', error: String(e) });
  }
}

/** Sends one segment to the Pond; null when it could not be asked. */
export type SegmentCheck = (fileUri: string) => Promise<WakeCheck | null>;

let segments: { remove(): void } | null = null;

/**
 * Answer the service's segments for the life of the JavaScript runtime, not of a screen: the
 * service hands them over while the app is in the background, when no screen is mounted. Each is
 * sent with `check`, deleted once answered, and opens the voice orb when the Pond heard the phrase.
 * `phraseHeard` receives the phrase each answer names. Installing again replaces the handlers.
 */
export function answerWakeSegments(check: SegmentCheck, phraseHeard: (phrase: string) => void): void {
  const native = wakeBridge();
  if (!native) return;
  segments?.remove();
  segments = DeviceEventEmitter.addListener('PondWakeSegment', (path: string) => {
    void (async () => {
      try {
        const answer = await check(`file://${path}`);
        if (!answer) return;
        phraseHeard(answer.phrase);
        if (answer.heard && !(await native.heard())) {
          console.warn('[wake] the Pond heard the phrase after listening stopped', { kind: 'phone_wake' });
        }
      } catch (e) {
        console.warn('[wake] a segment could not be answered', { kind: 'phone_wake', error: String(e) });
      } finally {
        native.done(path);
      }
    })();
  });
}
