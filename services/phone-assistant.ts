/**
 * Goose as the phone's digital assistant, on Android.
 *
 * The native half is `plugins/pond-assist/PondAssist.kt`: a voice interaction service that puts
 * the app in Settings > Default apps > Digital assistant app, and the overlay activity the assist
 * gesture opens (`components/assist/`). This is the JavaScript side of its module, `PondAssist`.
 *
 * Every call is safe anywhere: on iOS, which lets no app replace Siri, and on an Android build
 * that predates the plugin, there is no bridge, `assistantSupported()` is false and the rest do
 * nothing. See docs/ASSISTANT.md.
 */

import { NativeModules, Platform } from 'react-native';

interface AssistBridge {
  isAssistant(): Promise<boolean | null>;
  chooseAssistant(): Promise<boolean>;
  close(): Promise<boolean>;
}

function bridge(): AssistBridge | null {
  return Platform.OS === 'android' ? ((NativeModules.PondAssist as AssistBridge | undefined) ?? null) : null;
}

/** Whether this build can be the phone's assistant at all. */
export function assistantSupported(): boolean {
  return bridge() !== null;
}

/**
 * Whether Goose is the phone's assistant now. Null when that cannot be known: no bridge, Android 9
 * or older (no role to ask about), or the question failed, which is logged.
 */
export async function isPhoneAssistant(): Promise<boolean | null> {
  const native = bridge();
  if (!native) return null;
  try {
    return await native.isAssistant();
  } catch (e) {
    console.warn('[assistant] could not read the assistant role', { kind: 'phone_assistant', error: String(e) });
    return null;
  }
}

/**
 * Open the system screen where the assistant is chosen. Resolves whether one opened; Android
 * decides, and the caller reads the answer again when the app comes back to the front.
 */
export async function choosePhoneAssistant(): Promise<boolean> {
  const native = bridge();
  if (!native) return false;
  try {
    const opened = await native.chooseAssistant();
    if (!opened) console.warn('[assistant] no settings screen to choose the assistant', { kind: 'phone_assistant' });
    return opened;
  } catch (e) {
    console.warn('[assistant] could not open the assistant settings', { kind: 'phone_assistant', error: String(e) });
    return false;
  }
}

/** Close the assist overlay, which ends its conversation with it. */
export async function closeAssist(): Promise<void> {
  const native = bridge();
  if (!native) return;
  try {
    if (!(await native.close())) console.warn('[assistant] close asked with no overlay in front', { kind: 'phone_assistant' });
  } catch (e) {
    console.warn('[assistant] the overlay could not be closed', { kind: 'phone_assistant', error: String(e) });
  }
}
