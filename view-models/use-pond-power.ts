// The Pond's power mode, what it draws, and restarting it. A restart that would cut a long task's
// step short is asked about twice, and only the second answer sends `force`.

import { useCallback, useState } from 'react';

import { useConfirm } from '@/providers/confirm-provider';
import i18n from '@/services/i18n';
import type { AdminPower, PowerMode } from '@/services/types';
import { describeApiError } from './describe-error';
import { adminRefusal } from './pond-admin-source';
import { useAdminGate, useAdminLoad, type AdminGate } from './use-admin-gate';

export interface UsePondPower {
  gate: AdminGate;
  power: AdminPower | null;
  /** The modes can be read but not changed on this Pond. */
  fixed: boolean;
  /** A mode change waits for a restart. */
  rebootRequired: boolean;
  loading: boolean;
  error: string | null;
  notice: string | null;
  /** The mode being switched to, or null. */
  switching: number | null;
  restarting: boolean;
  actions: {
    refresh: () => Promise<void>;
    /** Asks first; resolves to whether the Pond switched. */
    choose: (mode: PowerMode) => Promise<boolean>;
    /** Asks first, and again if a long task is running; resolves to whether the Pond is restarting. */
    restart: () => Promise<boolean>;
  };
}

export function usePondPower(): UsePondPower {
  const ask = useConfirm();
  const { gate, source, noteFailure, touch, noteRestart } = useAdminGate();
  const [power, setPower] = useState<AdminPower | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rebootRequired, setRebootRequired] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [switching, setSwitching] = useState<number | null>(null);
  const [restarting, setRestarting] = useState(false);

  const read = useCallback(async () => {
    setReading(true);
    try {
      setPower(await source.power());
      setError(null);
      touch();
    } catch (e) {
      if (noteFailure(e)) return;
      setError(describeApiError(e) ?? i18n.t('myPond.power.readFailed'));
    } finally {
      setReading(false);
    }
  }, [noteFailure, source, touch]);

  useAdminLoad(read, gate);

  const choose = useCallback(
    async (mode: PowerMode) => {
      if (!power?.can_change || unavailable || switching !== null || mode.id === power.mode?.id) return false;
      const yes = await ask({
        title: i18n.t('myPond.power.switchTitle', { name: mode.name }),
        message: i18n.t('myPond.power.switchBody'),
        confirmLabel: i18n.t('myPond.power.switch'),
      });
      if (!yes) return false;
      setSwitching(mode.id);
      setError(null);
      setNotice(null);
      try {
        const change = await source.setPowerMode(mode.id);
        touch();
        const now = change.mode ?? mode;
        setPower((p) => (p ? { ...p, mode: now } : p));
        if (change.reboot_required) setRebootRequired(true);
        setNotice(
          change.reboot_required
            ? i18n.t('myPond.power.switchedAfterRestart', { name: now.name })
            : i18n.t('myPond.power.switched', { name: now.name }),
        );
        return true;
      } catch (e) {
        if (noteFailure(e)) return false;
        const code = adminRefusal(e);
        if (code === 'power_control_unavailable') {
          setUnavailable(true);
          setError(i18n.t('myPond.power.unavailable'));
        } else if (code === 'unknown_power_mode') {
          setError(i18n.t('myPond.power.unknownMode'));
          await read();
        } else {
          setError(describeApiError(e) ?? i18n.t('myPond.power.switchFailed'));
        }
        return false;
      } finally {
        setSwitching(null);
      }
    },
    [ask, noteFailure, power, read, source, switching, touch, unavailable],
  );

  const send = useCallback(
    async (force: boolean): Promise<'restarting' | 'busy' | 'failed'> => {
      try {
        await source.restart(force);
        return 'restarting';
      } catch (e) {
        if (adminRefusal(e) === 'long_task_running' && !force) return 'busy';
        if (noteFailure(e)) return 'failed';
        if (adminRefusal(e) === 'power_control_unavailable') {
          setUnavailable(true);
          setError(i18n.t('myPond.power.restartUnavailable'));
        } else {
          setError(describeApiError(e) ?? i18n.t('myPond.power.restartFailed'));
        }
        return 'failed';
      }
    },
    [noteFailure, source],
  );

  const restart = useCallback(async () => {
    if (restarting) return false;
    const yes = await ask({
      title: i18n.t('myPond.power.restartTitle'),
      message: i18n.t('myPond.power.restartBody'),
      confirmLabel: i18n.t('myPond.power.restart'),
      destructive: true,
    });
    if (!yes) return false;
    setRestarting(true);
    setError(null);
    setNotice(null);
    try {
      let outcome = await send(false);
      if (outcome === 'busy') {
        const anyway = await ask({
          title: i18n.t('myPond.power.busyTitle'),
          message: i18n.t('myPond.power.busyBody'),
          confirmLabel: i18n.t('myPond.power.restartAnyway'),
          destructive: true,
        });
        if (!anyway) return false;
        outcome = await send(true);
      }
      if (outcome !== 'restarting') return false;
      setRebootRequired(false);
      noteRestart();
      return true;
    } finally {
      setRestarting(false);
    }
  }, [ask, noteRestart, restarting, send]);

  return {
    gate,
    power,
    fixed: !!power && (!power.can_change || power.control === 'none' || unavailable),
    rebootRequired,
    loading: reading && power === null,
    error,
    notice,
    switching,
    restarting,
    actions: { refresh: read, choose, restart },
  };
}
