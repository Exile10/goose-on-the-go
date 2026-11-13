/**
 * The Pond's pairing lock, for a paired member: whether new phones are held, who the main member
 * is, and, for the main member, the lock itself, its recovery PIN and the phones waiting. Read
 * every few seconds while the screen is in front, because a waiting phone is gone in ten minutes.
 */

import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { isRecoveryPin, lockGap, type LockGap, type PairingLock, type PairingRequest } from '@/models/pairing-lock';
import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import { isMissingRoute } from './agents-source';
import { describeApiError, logFailure } from './describe-error';
import { useLive } from './use-live';

/** How often the lock and the phones waiting are read while the screen is open. */
export const PAIRING_LOCK_MS = 5_000;

/** The Pond's refusal for anyone but the main member. */
const MAIN_MEMBER_ONLY = 'pairing_main_member_only';

export interface UsePairingLock {
  data: {
    lock: PairingLock | null;
    /** The main member's name, when the Pond's profiles name them. */
    ownerName: string | null;
    /** Why a lock that is on is not holding. */
    gap: LockGap | null;
    requests: PairingRequest[];
  };
  loading: boolean;
  /** No read has worked yet and the last one failed. */
  failed: boolean;
  /** A Pond built before the pairing lock. */
  unsupported: boolean;
  error: string | null;
  /** What is being changed: `lock`, `pin`, or the id of the request being answered. */
  busy: string | null;
  /** Why the last PIN was not saved. */
  pinError: string | null;
  actions: {
    refresh: () => Promise<void>;
    setLocked: (locked: boolean) => Promise<void>;
    /** Resolves whether the PIN was saved. */
    savePin: (pin: string) => Promise<boolean>;
    removePin: () => Promise<void>;
    accept: (id: string) => Promise<void>;
    decline: (id: string) => Promise<void>;
  };
}

export function usePairingLock(): UsePairingLock {
  const { t } = useTranslation();
  const { hydrated } = useServer();
  const [lock, setLock] = useState<PairingLock | null>(null);
  const [requests, setRequests] = useState<PairingRequest[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  // Whether the main member's name has been asked for, so a poll asks for the profiles once.
  const namedFor = useRef<string | null>(null);
  const loaded = useRef(false);

  const read = useCallback(async () => {
    try {
      const next = await api.pairingLock();
      setLock(next);
      loaded.current = true;
      setFailed(false);
      setUnsupported(false);
      setError(null);
      if (next.ownerProfileId && namedFor.current !== next.ownerProfileId) {
        namedFor.current = next.ownerProfileId;
        void api
          .listProfiles()
          .then((profiles) => setNames(Object.fromEntries(profiles.map((p) => [p.id, p.display_name]))))
          .catch(() => {
            // Asked again on the next read: the name is a courtesy, not the lock.
            namedFor.current = null;
          });
      }
      if (!next.canChange) {
        setRequests([]);
        return;
      }
      try {
        setRequests(await api.pairingRequests());
      } catch (e) {
        // No longer the main member's to answer, since the lock was read: nothing waits for this phone.
        if (e instanceof ApiError && e.detail === MAIN_MEMBER_ONLY) setRequests([]);
        else throw e;
      }
    } catch (e) {
      if (isMissingRoute(e)) {
        setUnsupported(true);
        return;
      }
      logFailure('pairing-lock', 'read failed', e);
      if (!loaded.current) {
        setFailed(true);
        setError(describeApiError(e));
      }
    }
  }, []);

  useLive(read, PAIRING_LOCK_MS, hydrated);

  /** One change at a time, said in the snackbar when the Pond refuses it, and the lock read again after. */
  const change = useCallback(
    async (what: string, work: () => Promise<void>): Promise<boolean> => {
      setBusy(what);
      try {
        await work();
        return true;
      } catch (e) {
        logFailure('pairing-lock', `${what} failed`, e);
        const mine = e instanceof ApiError && e.detail === MAIN_MEMBER_ONLY;
        showSnackbar({ message: mine ? t('pairingLock.mainMemberOnly') : (describeApiError(e) ?? t('pairingLock.changeFailed')), tone: 'danger' });
        return false;
      } finally {
        await read();
        setBusy(null);
      }
    },
    [read, t],
  );

  const setLocked = useCallback(
    async (locked: boolean) => {
      // Shown at once, and put right by the read that follows if the Pond refused.
      setLock((was) => (was ? { ...was, locked } : was));
      await change('lock', () => api.setPairingLock(locked));
    },
    [change],
  );

  const savePin = useCallback(
    async (pin: string) => {
      setPinError(null);
      if (!isRecoveryPin(pin, lock?.minPinDigits)) {
        setPinError(t('pairingLock.pinInvalid'));
        return false;
      }
      setBusy('pin');
      try {
        await api.setRecoveryPin(pin);
        showSnackbar({ message: t('pairingLock.pinSaved'), tone: 'success' });
        return true;
      } catch (e) {
        logFailure('pairing-lock', 'pin failed', e);
        const refused = e instanceof ApiError ? e.detail : null;
        setPinError(
          refused === 'pin_not_six_to_twelve_digits'
            ? t('pairingLock.pinInvalid')
            : refused === MAIN_MEMBER_ONLY
              ? t('pairingLock.mainMemberOnly')
              : (describeApiError(e) ?? t('pairingLock.changeFailed')),
        );
        return false;
      } finally {
        await read();
        setBusy(null);
      }
    },
    [lock?.minPinDigits, read, t],
  );

  const removePin = useCallback(async () => {
    if (await change('pin', () => api.clearRecoveryPin())) showSnackbar({ message: t('pairingLock.pinRemoved'), tone: 'success' });
  }, [change, t]);

  const answer = useCallback(
    async (id: string, accept: boolean) => {
      const ok = await change(id, () => (accept ? api.approvePairingRequest(id) : api.declinePairingRequest(id)));
      if (ok) showSnackbar({ message: accept ? t('pairingLock.accepted') : t('pairingLock.declined'), tone: 'success' });
    },
    [change, t],
  );
  const accept = useCallback((id: string) => answer(id, true), [answer]);
  const decline = useCallback((id: string) => answer(id, false), [answer]);

  return {
    data: {
      lock,
      ownerName: lock?.ownerProfileId ? (names[lock.ownerProfileId] ?? null) : null,
      gap: lock ? lockGap(lock) : null,
      requests,
    },
    loading: lock === null && !failed && !unsupported,
    failed: failed && lock === null,
    unsupported,
    error,
    busy,
    pinError,
    actions: { refresh: read, setLocked, savePin, removePin, accept, decline },
  };
}

/** The lock in one line, for a row that leads to it. */
export interface PairingLockSummary {
  locked: boolean;
  enforced: boolean;
  /** Phones waiting for this phone's answer; none for anyone but the main member. */
  waiting: number;
}

export function lockSummaryWords(summary: PairingLockSummary): string {
  if (summary.waiting > 0) return i18n.t('pairingLock.summaryOnWaiting', { count: summary.waiting });
  if (!summary.locked) return i18n.t('pairingLock.summaryOff');
  return summary.enforced ? i18n.t('pairingLock.summaryOn') : i18n.t('pairingLock.summaryNotHolding');
}

/**
 * The lock for the Devices tab's row: read when the tab comes to the front and on a pull, never
 * polled. Null until read, and on a Pond with no pairing lock, where the row is not drawn.
 */
export function usePairingLockSummary(): { data: PairingLockSummary | null; actions: { refresh: () => Promise<void> } } {
  const { hydrated } = useServer();
  const [summary, setSummary] = useState<PairingLockSummary | null>(null);

  const refresh = useCallback(async () => {
    try {
      const lock = await api.pairingLock();
      const waiting = lock.canChange ? (await api.pairingRequests().catch(() => [])).length : 0;
      setSummary({ locked: lock.locked, enforced: lock.enforced, waiting });
    } catch (e) {
      if (isMissingRoute(e)) setSummary(null);
      else logFailure('pairing-lock', 'summary read failed', e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (hydrated) void refresh();
    }, [hydrated, refresh]),
  );

  return { data: summary, actions: { refresh } };
}
