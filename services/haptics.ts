/**
 * Tactile feedback, named by what happened rather than by waveform.
 *
 * Call sites say `confirm()` or `reject()`; this file decides what that feels
 * like. Naming the intent is what keeps a "light impact" from drifting onto
 * three unrelated gestures and losing its meaning.
 *
 * Every call is fire-and-forget and swallows its own failure: haptics are
 * absent on web, on the simulator and on devices whose motor is disabled, and
 * none of those is an error a caller should handle.
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { Storage } from './storage';

const supported = Platform.OS === 'ios' || Platform.OS === 'android';

let enabled = true;

/** Turn all feedback off, for a user setting or a test. */
export function setHapticsEnabled(next: boolean): void {
  enabled = next;
}

/** The Settings switch: applies at once and is remembered on this phone. */
export async function saveHapticsPreference(next: boolean): Promise<void> {
  enabled = next;
  await Storage.set('hapticsEnabled', next ? '1' : '0').catch(() => undefined);
}

/** Read the remembered choice at launch. Nothing stored means on. */
export async function loadHapticsPreference(): Promise<void> {
  const stored = await Storage.get('hapticsEnabled').catch(() => null);
  if (stored !== null) enabled = stored !== '0';
}

export function hapticsEnabled(): boolean {
  return enabled;
}

async function run(fn: () => Promise<void>): Promise<void> {
  if (!supported || !enabled) return;
  try {
    await fn();
  } catch {
    // A missing or disabled motor is not a failure worth surfacing.
  }
}

/** Moving between tabs, filters, or segments. The lightest thing there is. */
export function selectionTick(): Promise<void> {
  return run(() => Haptics.selectionAsync());
}

/** A button doing something ordinary. */
export function tap(): Promise<void> {
  return run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A control whose result is physical: a switch, a slider detent. */
export function toggle(): Promise<void> {
  return run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** Something completed and the reader can move on. */
export function confirm(): Promise<void> {
  return run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Something needs attention but nothing was lost. */
export function caution(): Promise<void> {
  return run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

/** The action failed. */
export function reject(): Promise<void> {
  return run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
