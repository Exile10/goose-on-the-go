// My Pond: the lock, and once open what the Pond holds. Only the status is polled, because
// it alone does not renew the unlock; reading anything else every 30 s would keep it open forever.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { diskUsed, groupAreas, healthNeedsAttention, healthSummary, minutesLeft, type AreaGroupId } from '@/models/pond-admin';
import { useConfirm } from '@/providers/confirm-provider';
import { useServer } from '@/providers/server-provider';
import i18n from '@/services/i18n';
import type { AdminCheckStatus, AdminHealth, AdminOverview } from '@/services/types';
import { describeApiError } from './describe-error';
import { useAdminGate, type AdminGate } from './use-admin-gate';
import { useLive } from './use-live';

/** Gentle: soon enough to show the lock that lapsed while the phone was down, about two requests a minute. */
export const ADMIN_STATUS_MS = 30_000;

export interface MyPondPart {
  id: AreaGroupId;
  bytes: number;
}

export interface UseMyPond {
  gate: AdminGate;
  overview: AdminOverview | null;
  /** What the Pond keeps, in four parts that always come in the same order. */
  parts: MyPondPart[];
  disk: { used: number; total: number; free: number; fraction: number } | null;
  /** Whole minutes before the Pond locks My Pond again, or null when unknown. */
  locksIn: number | null;
  /** Any health check is not ok, so the Health row carries a badge. */
  healthWarning: boolean;
  /** The worst of the health checks, or null before they are read. */
  healthStatus: AdminCheckStatus | null;
  /** The overview is out for the first time. */
  loading: boolean;
  refreshing: boolean;
  /** What went wrong reading the overview, in words. */
  error: string | null;
  locking: boolean;
  /** This phone keeps its own key to My Pond, which it can forget. */
  kept: boolean;
  actions: {
    refresh: () => Promise<void>;
    lock: () => Promise<boolean>;
    /** Asks first; on yes the key is revoked on the Pond and here, and My Pond locks. */
    forgetKey: () => Promise<boolean>;
  };
}

export function useMyPond(): UseMyPond {
  const { hydrated } = useServer();
  const ask = useConfirm();
  const { gate, source, readStatus, noteFailure, noteLocked, touch, forgetKept } = useAdminGate();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // The Developer toggle swapping the Pond: nothing read from the old one describes the new one.
  const [from, setFrom] = useState(source);
  if (from !== source) {
    setFrom(source);
    setOverview(null);
    setHealth(null);
    setError(null);
  }

  const unlocked = gate.phase === 'unlocked';

  const loadDetails = useCallback(async () => {
    setReading(true);
    const [o, h] = await Promise.allSettled([source.overview(), source.health()]);
    if (o.status === 'fulfilled') {
      setOverview(o.value);
      setError(null);
      touch();
    } else if (!noteFailure(o.reason)) {
      setError(describeApiError(o.reason) ?? i18n.t('myPond.overview.failed'));
    }
    if (h.status === 'fulfilled') setHealth(h.value);
    else noteFailure(h.reason);
    setReading(false);
  }, [noteFailure, source, touch]);

  const poll = useCallback(async () => {
    await readStatus();
    setNow(Date.now());
  }, [readStatus]);

  // A Pond that predates My Pond, or a guest's phone, will not answer differently in 30 s.
  const polling = hydrated && gate.phase !== 'unsupported' && gate.phase !== 'members_only';
  useLive(poll, ADMIN_STATUS_MS, polling);

  // Read once on each arrival and after each unlock, never on the poll's beat. The key changes with
  // each unlock and is null while closed.
  const openKey = hydrated && unlocked ? gate.unlocks : null;
  const loadRef = useRef(loadDetails);
  useEffect(() => {
    loadRef.current = loadDetails;
  });
  useFocusEffect(
    useCallback(() => {
      if (openKey !== null) void loadRef.current();
    }, [openKey]),
  );

  const refresh = useCallback(async () => {
    const answered = await readStatus();
    setNow(Date.now());
    if (answered) await loadRef.current();
  }, [readStatus]);

  const lock = useCallback(async () => {
    if (locking) return false;
    setLocking(true);
    try {
      await source.lock();
      noteLocked();
      return true;
    } catch (e) {
      if (noteFailure(e)) return true;
      setError(describeApiError(e) ?? i18n.t('myPond.lock.lockFailed'));
      return false;
    } finally {
      setLocking(false);
    }
  }, [locking, noteFailure, noteLocked, source]);

  const forgetKey = useCallback(async () => {
    const yes = await ask({
      title: i18n.t('myPond.key.forgetTitle'),
      message: i18n.t('myPond.key.forgetBody'),
      confirmLabel: i18n.t('myPond.key.forgetConfirm'),
      cancelLabel: i18n.t('myPond.keepIt'),
      destructive: true,
    });
    if (!yes) return false;
    await forgetKept();
    return true;
  }, [ask, forgetKept]);

  const disk = overview
    ? { ...diskUsed(overview.disk), total: overview.disk.total_bytes, free: overview.disk.free_bytes }
    : null;

  return {
    gate,
    overview: unlocked ? overview : null,
    parts: unlocked && overview ? groupAreas(overview.areas) : [],
    disk: unlocked ? disk : null,
    locksIn: unlocked ? minutesLeft(gate.status?.expires_at ?? null, now) : null,
    healthWarning: unlocked && healthNeedsAttention(health),
    healthStatus: unlocked && health ? healthSummary(health).status : null,
    loading: unlocked && reading && overview === null,
    refreshing: reading && overview !== null,
    error: unlocked ? error : null,
    locking,
    kept: gate.kept,
    actions: { refresh, lock, forgetKey },
  };
}
