// Whether My Pond is unlocked, shared by the tab and every screen under it: any admin route that
// answers `admin_locked` returns the whole area to the lock, wherever it was asked from.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';

import { adminPasswordProblem, formatAdminPassword, normalizeAdminPassword, type AdminPasswordProblem } from '@/models/pond-admin';
import { useServer } from '@/providers/server-provider';
import i18n from '@/services/i18n';
import type { AdminStatus } from '@/services/types';
import { isMissingRoute } from './agents-source';
import { describeApiError } from './describe-error';
import { adminRefusal, coolingSeconds, usePondAdminSource, type PondAdminSource } from './pond-admin-source';

export type AdminPhase =
  /** Nothing heard from the Pond yet. */
  | 'checking'
  | 'locked'
  | 'unlocked'
  /** No administrator card was ever made on this Pond. */
  | 'no_card'
  /** This phone is not a household member's, such as a guest's. */
  | 'members_only'
  /** A Pond built before My Pond. */
  | 'unsupported'
  /** The status could not be read and nothing was known before. */
  | 'unreachable';

export interface AdminGate {
  phase: AdminPhase;
  status: AdminStatus | null;
  /** When the Pond will hear the card again, by this phone's clock; null when it is not slowing guesses. */
  coolingUntil: number | null;
  /** Counts unlocks, so a screen that found itself locked reads again once it is open. */
  unlocks: number;
  /** A restart was asked for, which ends every unlock. Cleared by the next status the Pond answers. */
  restarting: boolean;
}

const INITIAL: AdminGate = { phase: 'checking', status: null, coolingUntil: null, unlocks: 0, restarting: false };

/** The phases in which the admin routes are not worth asking. */
const CLOSED: readonly AdminPhase[] = ['locked', 'no_card', 'members_only', 'unsupported'];

export function isGateClosed(phase: AdminPhase): boolean {
  return CLOSED.includes(phase);
}

class GateStore {
  private state: AdminGate = INITIAL;
  private listeners = new Set<() => void>();

  get = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(next: Partial<AdminGate>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => l());
  }

  status(status: AdminStatus, now: number) {
    this.set({
      phase: status.card === 'missing' ? 'no_card' : status.unlocked ? 'unlocked' : 'locked',
      status,
      coolingUntil: status.retry_after ? now + status.retry_after * 1000 : null,
      restarting: false,
    });
  }

  locked() {
    const status = this.state.status;
    this.set({ phase: 'locked', status: status ? { ...status, unlocked: false, expires_at: null } : null });
  }

  unlocked(expiresAt: string | null) {
    const base: AdminStatus = this.state.status ?? { card: 'present', unlocked: true, expires_at: null, idle_minutes: 15, retry_after: null };
    this.set({
      phase: 'unlocked',
      status: { ...base, unlocked: true, expires_at: expiresAt, retry_after: null },
      coolingUntil: null,
      unlocks: this.state.unlocks + 1,
      restarting: false,
    });
  }

  /** An admin request was admitted, which renews the unlock on the Pond: the countdown starts again. */
  touched(now: number) {
    const status = this.state.status;
    if (this.state.phase !== 'unlocked' || !status) return;
    this.set({ status: { ...status, expires_at: new Date(now + status.idle_minutes * 60_000).toISOString() } });
  }
}

const stores = new Map<PondAdminSource, GateStore>();

function storeFor(source: PondAdminSource): GateStore {
  let store = stores.get(source);
  if (!store) {
    store = new GateStore();
    stores.set(source, store);
  }
  return store;
}

/** For tests: every gate starts unknown again. */
export function resetAdminGates(): void {
  stores.clear();
}

export interface UseAdminGate {
  gate: AdminGate;
  source: PondAdminSource;
  /** Reads `GET /admin/status`, which never renews the unlock. Resolves to whether the Pond answered. */
  readStatus: () => Promise<boolean>;
  /**
   * For a screen whose admin request failed: true when the failure moved the gate (locked, a guest's
   * phone, no card), so the screen shows the lock rather than an error of its own.
   */
  noteFailure: (e: unknown) => boolean;
  /** For a screen whose admin request succeeded, which renewed the unlock. */
  touch: () => void;
  /** The Pond took a lock. */
  noteLocked: () => void;
  /** After asking the Pond to restart, which locks everyone. */
  noteRestart: () => void;
}

export function useAdminGate(): UseAdminGate {
  const source = usePondAdminSource();
  const store = storeFor(source);
  const gate = useSyncExternalStore(store.subscribe, store.get, store.get);

  const noteFailure = useCallback(
    (e: unknown) => {
      switch (adminRefusal(e)) {
        case 'admin_locked':
          store.locked();
          return true;
        case 'admin_members_only':
          store.set({ phase: 'members_only' });
          return true;
        case 'admin_card_missing':
          store.set({ phase: 'no_card' });
          return true;
        default:
          return false;
      }
    },
    [store],
  );

  const readStatus = useCallback(async () => {
    try {
      store.status(await source.status(), Date.now());
      return true;
    } catch (e) {
      if (noteFailure(e)) return true;
      if (isMissingRoute(e)) store.set({ phase: 'unsupported' });
      else if (store.get().phase === 'checking') store.set({ phase: 'unreachable' });
      return false;
    }
  }, [noteFailure, source, store]);

  const touch = useCallback(() => store.touched(Date.now()), [store]);
  const noteLocked = useCallback(() => store.locked(), [store]);
  const noteRestart = useCallback(() => {
    store.locked();
    store.set({ restarting: true });
  }, [store]);

  return { gate, source, readStatus, noteFailure, touch, noteLocked, noteRestart };
}

/**
 * A screen under My Pond reads on each arrival and again after each unlock, and not while the area is
 * locked. The key changes with each unlock and is null while closed.
 */
export function useAdminLoad(load: () => Promise<void>, gate: AdminGate): void {
  const { hydrated } = useServer();
  const openKey = hydrated && !isGateClosed(gate.phase) ? gate.unlocks : null;
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useFocusEffect(
    useCallback(() => {
      if (openKey !== null) void loadRef.current();
    }, [openKey]),
  );
}

export interface UseAdminUnlock {
  /** What was typed, in the card's own groups: `XXXX-XXXX-XXXX-XXXX`. */
  password: string;
  /** Why the password cannot be sent yet; `empty` and `short` are not mistakes, only unfinished. */
  problem: AdminPasswordProblem | null;
  /** How many characters of the sixteen are in. */
  typed: number;
  unlocking: boolean;
  /** Seconds before the Pond hears the card again; zero when it is not cooling. */
  coolingSecs: number;
  /** Why the last unlock did not work, in words. */
  error: string | null;
  setPassword: (raw: string) => void;
  /** Resolves to whether My Pond is now unlocked. */
  unlock: () => Promise<boolean>;
}

/** The lock's form, shared by the tab and by any screen under it that finds itself locked. */
export function useAdminUnlock(): UseAdminUnlock {
  const { gate, source, readStatus, noteFailure } = useAdminGate();
  const store = storeFor(source);
  const [password, setPasswordState] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // A countdown on screen, not a poll: nothing is asked of the Pond while it runs.
  const until = gate.coolingUntil;
  useEffect(() => {
    if (until === null) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(() => {
      tick();
      if (Date.now() >= until) clearInterval(timer);
    }, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [until]);
  const coolingSecs = until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));

  const setPassword = useCallback((raw: string) => {
    setPasswordState(formatAdminPassword(raw));
    setError(null);
  }, []);

  const problem = adminPasswordProblem(password);

  const unlock = useCallback(async () => {
    if (unlocking || adminPasswordProblem(password) !== null || coolingSecs > 0) return false;
    setUnlocking(true);
    setError(null);
    try {
      const answer = await source.unlock(normalizeAdminPassword(password));
      store.unlocked(answer.expires_at);
      setPasswordState('');
      return true;
    } catch (e) {
      const code = adminRefusal(e);
      if (code === 'admin_cooling') {
        const wait = coolingSeconds(e);
        // The countdown says it; a sentence beside it would outlive the wait.
        store.set({ coolingUntil: Date.now() + (wait ?? 30) * 1000 });
      } else if (code === 'admin_password_rejected') {
        setError(i18n.t('myPond.lock.rejected'));
        // The Pond starts slowing guesses after a few; its status says when.
        void readStatus();
      } else if (code === 'admin_password_malformed') {
        setError(i18n.t('myPond.lock.malformed'));
      } else if (noteFailure(e)) {
        setError(null);
      } else if (isMissingRoute(e)) {
        store.set({ phase: 'unsupported' });
      } else {
        setError(describeApiError(e) ?? i18n.t('myPond.lock.failed'));
      }
      return false;
    } finally {
      setUnlocking(false);
    }
  }, [coolingSecs, noteFailure, password, readStatus, source, store, unlocking]);

  return {
    password,
    problem,
    typed: normalizeAdminPassword(password).length,
    unlocking,
    coolingSecs,
    error,
    setPassword,
    unlock,
  };
}
