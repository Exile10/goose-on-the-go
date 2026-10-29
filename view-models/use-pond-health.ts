// How the Pond's machine is doing. Read on arrival and on a pull, never polled: every read renews the
// unlock, and a screen left open would otherwise keep My Pond open with it.

import { useCallback, useState } from 'react';

import i18n from '@/services/i18n';
import type { AdminHealth } from '@/services/types';
import { describeApiError } from './describe-error';
import { useAdminGate, useAdminLoad, type AdminGate } from './use-admin-gate';

export interface UsePondHealth {
  gate: AdminGate;
  health: AdminHealth | null;
  loading: boolean;
  error: string | null;
  actions: { refresh: () => Promise<void> };
}

export function usePondHealth(): UsePondHealth {
  const { gate, source, noteFailure, touch } = useAdminGate();
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    setReading(true);
    try {
      setHealth(await source.health());
      setError(null);
      touch();
    } catch (e) {
      if (noteFailure(e)) return;
      setError(describeApiError(e) ?? i18n.t('myPond.health.readFailed'));
    } finally {
      setReading(false);
    }
  }, [noteFailure, source, touch]);

  useAdminLoad(read, gate);

  return { gate, health, loading: reading && health === null, error, actions: { refresh: read } };
}
