/**
 * What the paired Pond said it can do (`routines`, ...), from its answer to pairing and to each
 * token refresh. Kept with the Pond's pin, so after pairing with another Pond the old answer is
 * never read as the new one's. Not a secret: the Pond tells any phone that pairs.
 */

import { Storage } from './storage';

interface Saved {
  pin: string;
  capabilities: string[];
}

let cached: Saved | null = null;
const listeners = new Set<() => void>();

/** Keep what the Pond with this pin said it can do, and tell whoever is reading. */
export async function rememberCapabilities(pin: string, capabilities: unknown): Promise<void> {
  if (!Array.isArray(capabilities)) return;
  cached = { pin, capabilities: capabilities.filter((c): c is string => typeof c === 'string') };
  listeners.forEach((listener) => listener());
  try {
    await Storage.set('pondCapabilities', JSON.stringify(cached));
  } catch (e) {
    console.warn('[capabilities] could not keep them', e instanceof Error ? e.message : e);
  }
}

/** What the Pond with this pin said it can do, or null when it has not said yet. */
export async function capabilitiesFor(pin: string): Promise<string[] | null> {
  if (!cached) {
    try {
      const raw = await Storage.get('pondCapabilities');
      const parsed = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
      if (parsed && typeof parsed.pin === 'string' && Array.isArray(parsed.capabilities)) {
        cached = { pin: parsed.pin, capabilities: parsed.capabilities.filter((c) => typeof c === 'string') };
      }
    } catch {
      // Unreadable is the same as not said: the Pond says again on the next refresh.
    }
  }
  return cached && cached.pin === pin ? cached.capabilities : null;
}

/** Called whenever a Pond's answer is kept; returns the unsubscribe. */
export function onCapabilities(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For tests: forget what is held in memory. */
export function resetCapabilitiesCache(): void {
  cached = null;
}
