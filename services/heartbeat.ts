/**
 * When the phone tells the Pond it is still here.
 *
 * The Pond derives a device's `is_online` from `last_seen` against a five-minute threshold, so a
 * paired phone has to refresh its own row or it ages out of its own device list. The interval is
 * the Pond's threshold with margin for one dropped request; see `server-provider.tsx`.
 */
import type { AppStateStatus } from 'react-native';

/** Two minutes: inside the Pond's five, and thirty requests an hour against a per-IP budget. */
export const HEARTBEAT_MS = 120_000;

export interface BeatConditions {
  /** A paired identity is loaded. */
  paired: boolean;
  /** A pairing is being staged, so the identity is half-built. */
  pairing: boolean;
  /** Where the connection manager reached the Pond; null until a probe succeeds. */
  url: string | null;
  appState: AppStateStatus | null;
}

/**
 * Whether a beat now would reach the Pond and say something true.
 *
 * It needs a resolved URL: before a probe succeeds the client still points at its default
 * address, and a beat there goes nowhere. It stops only in a known background state. On an
 * Android cold start AppState can read 'unknown' before the activity resumes, and nothing but the
 * UI mounts the provider that calls this, so "not yet known" is on screen, not away from it.
 */
export function canBeat({ paired, pairing, url, appState }: BeatConditions): boolean {
  if (!paired || pairing || !url) return false;
  return appState !== 'background';
}
