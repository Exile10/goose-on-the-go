/**
 * "Hey Goose" on the phone, on Android: the app listens for the phrase itself and opens the
 * assistant's voice orb (docs/ASSISTANT.md).
 *
 * The native half is `plugins/pond-wake/PondWake.kt`: a microphone foreground service running the
 * Pond's own detector (`native/pondear`, from the Pond's pond-ear crate). This is the JavaScript
 * side of its module, `PondWake`.
 *
 * Every call is safe anywhere: on iOS, which lets no app listen in the background this way, on an
 * Android build without the plugin, or on a CPU without the detector, `phoneWakeSupported()` is
 * false and the rest do nothing.
 */

import { NativeModules, Platform } from 'react-native';

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

interface WakeBridge {
  available(): boolean;
  state(): Promise<PhoneWakeState>;
  choose(on: boolean, words: WakeNotificationWords | Record<string, never>): Promise<boolean>;
  resume(): Promise<boolean>;
}

function bridge(): WakeBridge | null {
  if (Platform.OS !== 'android') return null;
  return (NativeModules.PondWake as WakeBridge | undefined) ?? null;
}

/** Whether this build, CPU and Android version can listen for "Hey Goose". */
export function phoneWakeSupported(): boolean {
  const native = bridge();
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
  const native = bridge();
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
  const native = bridge();
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
  const native = bridge();
  if (!native) return;
  try {
    await native.resume();
  } catch (e) {
    console.warn('[wake] could not resume listening', { kind: 'phone_wake', error: String(e) });
  }
}
