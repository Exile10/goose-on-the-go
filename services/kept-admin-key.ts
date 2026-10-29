// This phone's own key to My Pond, for the one Pond it is paired with. The marker names that Pond
// without a biometric prompt, because Android asks for one on every read of the key itself.

import { AdminKeyKeychain } from './secure-storage';
import { Storage } from './storage';

/** A key that was kept is gone: a new face or fingerprint invalidated it, or the passcode was removed. */
export class KeptAdminKeyLost extends Error {
  constructor() {
    super('The admin key this phone kept is no longer readable');
    this.name = 'KeptAdminKeyLost';
  }
}

export function canKeepAdminKey(): boolean {
  return AdminKeyKeychain.available();
}

/** Whether a key is kept for the Pond with this pin; asks nothing of the phone's biometrics. */
export async function isAdminKeyKeptFor(pin: string | null): Promise<boolean> {
  if (!pin) return false;
  return (await Storage.get('adminKeyFor').catch(() => null)) === pin;
}

/** Saving prompts for biometrics on Android. A failed or refused save leaves nothing kept. */
export async function keepAdminKey(pin: string, key: string, prompt: string): Promise<void> {
  if (!canKeepAdminKey()) throw new Error('This phone cannot keep a key behind its biometrics');
  try {
    await AdminKeyKeychain.save(key, prompt);
  } catch (e) {
    // The save deletes any older key first, so a marker left behind would point at nothing.
    await Storage.remove('adminKeyFor').catch(() => undefined);
    throw e;
  }
  await Storage.set('adminKeyFor', pin);
}

/**
 * The kept key, after the phone's biometrics; null when none is kept for this Pond. Throws when the
 * person says no, and throws `KeptAdminKeyLost` when the key is no longer there to read.
 */
export async function readKeptAdminKey(pin: string, prompt: string): Promise<string | null> {
  if (!(await isAdminKeyKeptFor(pin))) return null;
  const key = await AdminKeyKeychain.read(prompt);
  // SecureStore answers null, not an error, for an item the system invalidated.
  if (key === null) throw new KeptAdminKeyLost();
  return key;
}

export async function forgetKeptAdminKey(): Promise<void> {
  await Storage.remove('adminKeyFor').catch(() => undefined);
  await AdminKeyKeychain.forget().catch(() => undefined);
}

/** A read that failed because the key itself is gone, not because the person said no. */
export function keptKeyIsLost(e: unknown): boolean {
  if (e instanceof KeptAdminKeyLost) return true;
  const message = e instanceof Error ? e.message : String(e);
  return /invalidat|could not be found|no biometrics enrolled/i.test(message);
}

/** The person dismissed the Face ID or fingerprint prompt. */
export function keptKeyWasCancelled(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /cancel/i.test(message);
}
