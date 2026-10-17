/**
 * Whether the paired Pond still needs its owner to set it up. Asked once per pairing, and answered
 * again whenever the Pond refuses a request with `onboarding_required`.
 */

import { useEffect, useSyncExternalStore } from 'react';

import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';

export type SetupState = 'unknown' | 'needed' | 'done';

interface Gate {
  profileId: string;
  state: SetupState;
  /** Setup finished and was left before the Pond could answer, so Home keeps saying so. */
  gettingReady: boolean;
}

let gate: Gate = { profileId: '', state: 'unknown', gettingReady: false };
const listeners = new Set<() => void>();
// One question in flight per pairing; a second caller waits on the first.
let asking: { profileId: string; answer: Promise<SetupState> } | null = null;

function set(next: Gate) {
  gate = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Ask the Pond. `unknown` when it cannot be reached: Home then shows, and the next refusal says more. */
export function checkSetup(profileId: string): Promise<SetupState> {
  if (asking?.profileId === profileId) return asking.answer;
  const answer = api
    .onboardStatus()
    .then((status): SetupState => (status.onboarded ? 'done' : 'needed'))
    .catch((): SetupState => 'unknown')
    .then((state) => {
      if (asking?.profileId === profileId) asking = null;
      if (state !== 'unknown') set({ profileId, state, gettingReady: gate.profileId === profileId && gate.gettingReady });
      return state;
    });
  asking = { profileId, answer };
  return answer;
}

/** For the moment pairing succeeds, before the new pairing has rendered: whether to open setup instead of Home. */
export function setupNeededNow(): Promise<boolean> {
  return api
    .onboardStatus()
    .then((status) => !status.onboarded)
    .catch(() => false);
}

export function markSetupNeeded(profileId: string): void {
  if (gate.profileId !== profileId || gate.state !== 'needed') set({ profileId, state: 'needed', gettingReady: false });
}

export function markSetupDone(profileId: string): void {
  set({ profileId, state: 'done', gettingReady: gate.profileId === profileId && gate.gettingReady });
}

export function markGettingReady(profileId: string, on: boolean): void {
  set({ profileId, state: gate.profileId === profileId ? gate.state : 'done', gettingReady: on });
}

/** Whether Home should keep showing that the Pond paired now is still getting ready. */
export function useGettingReady(): boolean {
  const { profileId } = useServer();
  const snap = useSyncExternalStore(subscribe, () => gate);
  return snap.profileId === profileId && snap.gettingReady;
}

/** The answer for the Pond paired now; a different pairing starts from `unknown`. */
export function useSetupGate(): SetupState {
  const { hydrated, paired, profileId } = useServer();
  const snap = useSyncExternalStore(subscribe, () => gate);
  const state = snap.profileId === profileId ? snap.state : 'unknown';

  useEffect(() => {
    if (!hydrated || !paired || !profileId) return;
    api.setOnboardingRequired(() => markSetupNeeded(profileId));
    if (gate.profileId !== profileId || gate.state === 'unknown') void checkSetup(profileId);
    return () => api.setOnboardingRequired(null);
  }, [hydrated, paired, profileId]);

  return state;
}

/** For tests: forget everything held. */
export function resetSetupGate(): void {
  gate = { profileId: '', state: 'unknown', gettingReady: false };
  asking = null;
  listeners.forEach((l) => l());
}
