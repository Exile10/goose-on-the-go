// Whether the Pond's notices arrived and its messages were answered, over 7 or 30 days. Read on
// arrival, on a change of days and on a pull, never polled: every read renews My Pond's unlock.

import { useCallback, useEffect, useRef, useState } from 'react';

import i18n from '@/services/i18n';
import type { AdminReliability } from '@/services/types';
import { describeApiError } from './describe-error';
import { useAdminGate, useAdminLoad, type AdminGate } from './use-admin-gate';

export const RELIABILITY_DAYS = [7, 30] as const;
export type ReliabilityDays = (typeof RELIABILITY_DAYS)[number];

export interface UsePondReliability {
  gate: AdminGate;
  days: ReliabilityDays;
  report: AdminReliability | null;
  loading: boolean;
  error: string | null;
  actions: { refresh: () => Promise<void>; setDays: (days: ReliabilityDays) => void };
}

export function usePondReliability(): UsePondReliability {
  const { gate, source, noteFailure, touch } = useAdminGate();
  const [days, setDaysState] = useState<ReliabilityDays>(7);
  const [report, setReport] = useState<AdminReliability | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const daysRef = useRef(days);
  // Each read is numbered, so a slow 7-day answer never lands over the 30 days asked after it.
  const asked = useRef(0);

  const read = useCallback(async () => {
    const mine = ++asked.current;
    const wanted = daysRef.current;
    setReading(true);
    try {
      const next = await source.reliability(wanted);
      if (mine !== asked.current) return;
      setReport(next);
      setError(null);
      touch();
    } catch (e) {
      if (mine !== asked.current || noteFailure(e)) return;
      setError(describeApiError(e) ?? i18n.t('myPond.reliability.readFailed'));
    } finally {
      if (mine === asked.current) setReading(false);
    }
  }, [noteFailure, source, touch]);

  useAdminLoad(read, gate);

  const setDays = useCallback((next: ReliabilityDays) => {
    if (daysRef.current === next) return;
    daysRef.current = next;
    setDaysState(next);
  }, []);

  // A change of days reads again; the first read is `useAdminLoad`'s.
  const shown = useRef(days);
  useEffect(() => {
    if (shown.current === days) return;
    shown.current = days;
    void read();
  }, [days, read]);

  const current = report && report.days === days ? report : null;
  return { gate, days, report: current ?? report, loading: reading && current === null, error, actions: { refresh: read, setDays } };
}
