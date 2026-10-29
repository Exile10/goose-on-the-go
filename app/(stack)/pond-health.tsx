// How the Pond's machine is doing: its checks first, then the readings they come from.

import React from 'react';
import { RefreshControl, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkBadge, InkButton, InkSpinner } from '@jarida/ink/native';

import { AdminLockView } from '@/components/pond/admin-lock';
import { SettingsGroup, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import { SettingsScroll } from '@/components/settings/settings-scroll';
import type { TileColor } from '@/constants/colors';
import { sizeWords } from '@/models/pond-admin';
import type { AdminCheckStatus } from '@/services/types';
import { checkLabel, checkStatusIcon, checkStatusLabel, durationWords, zoneLabel } from '@/view-models/pond-admin-words';
import { usePondHealth } from '@/view-models/use-pond-health';

const TONE: Record<AdminCheckStatus, 'success' | 'warning' | 'danger'> = { ok: 'success', warning: 'warning', critical: 'danger' };
const TILE: Record<AdminCheckStatus, TileColor> = { ok: 'green', warning: 'amber', critical: 'red' };

export default function PondHealthScreen() {
  const { t } = useTranslation();
  const { gate, health, loading, error, actions } = usePondHealth();

  if (gate.phase !== 'unlocked' && gate.phase !== 'checking') {
    return (
      <SettingsScroll typing>
        <AdminLockView onRetry={() => void actions.refresh()} />
      </SettingsScroll>
    );
  }

  if (loading || !health) {
    return (
      <SettingsScroll>
        {loading ? (
          <InkSpinner label={t('myPond.health.loading')} />
        ) : (
          <View>
            <SettingsMessage tone="danger">{error ?? t('myPond.health.readFailed')}</SettingsMessage>
            <InkButton variant="quiet" icon="refresh" onPress={() => void actions.refresh()}>
              {t('common.retry')}
            </InkButton>
          </View>
        )}
      </SettingsScroll>
    );
  }

  const { host, memory, disk, process } = health;
  const load = host.load.map((n) => n.toFixed(2)).join('  ');

  return (
    <SettingsScroll refreshControl={<RefreshControl refreshing={false} onRefresh={() => void actions.refresh()} />}>
      <SettingsGroup title={t('myPond.health.checks')}>
        {health.checks.length === 0 ? <SettingsRow label={t('myPond.health.noChecks')} /> : null}
        {health.checks.map((check, i) => (
          <SettingsRow
            key={`${check.id}:${i}`}
            label={checkLabel(check.id)}
            icon={checkStatusIcon(check.status)}
            tile={TILE[check.status]}
            trailing={<InkBadge tone={TONE[check.status]}>{checkStatusLabel(check.status)}</InkBadge>}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup title={t('myPond.health.machine')}>
        {host.hostname ? <SettingsRow label={t('myPond.health.hostname')} value={host.hostname} /> : null}
        {host.os ? <SettingsRow label={t('myPond.health.os')} value={host.arch ? `${host.os} (${host.arch})` : host.os} /> : null}
        {host.cpus !== null ? <SettingsRow label={t('myPond.health.cpus')} value={String(host.cpus)} /> : null}
        {load ? <SettingsRow label={t('myPond.health.load')} description={t('myPond.health.loadHint')} value={load} /> : null}
        {host.uptime_secs !== null ? <SettingsRow label={t('myPond.health.hostUptime')} value={durationWords(host.uptime_secs)} /> : null}
      </SettingsGroup>

      <SettingsGroup title={t('myPond.health.resources')}>
        {memory ? (
          <SettingsRow
            label={t('myPond.health.memory')}
            value={t('myPond.health.available', { free: sizeWords(memory.available_bytes), total: sizeWords(memory.total_bytes) })}
          />
        ) : null}
        {memory && memory.swap_total_bytes > 0 ? (
          <SettingsRow
            label={t('myPond.health.swap')}
            value={t('myPond.health.available', { free: sizeWords(memory.swap_free_bytes), total: sizeWords(memory.swap_total_bytes) })}
          />
        ) : null}
        {disk ? (
          <SettingsRow
            label={t('myPond.health.disk')}
            value={t('myPond.health.diskFree', { free: sizeWords(disk.free_bytes), total: sizeWords(disk.total_bytes) })}
          />
        ) : null}
        {process ? <SettingsRow label={t('myPond.health.process')} value={sizeWords(process.rss_bytes)} /> : null}
      </SettingsGroup>

      {health.temperatures.length > 0 ? (
        <SettingsGroup title={t('myPond.health.temperatures')}>
          {health.temperatures.map((zone) => (
            <SettingsRow
              key={zone.zone}
              label={zoneLabel(zone.zone)}
              value={t('myPond.health.celsius', { value: zone.celsius.toFixed(1) })}
            />
          ))}
        </SettingsGroup>
      ) : null}

      <SettingsGroup title={t('myPond.health.software')}>
        {health.version ? <SettingsRow label={t('myPond.health.version')} value={health.version} /> : null}
        {health.uptime_secs !== null ? <SettingsRow label={t('myPond.health.uptime')} value={durationWords(health.uptime_secs)} /> : null}
      </SettingsGroup>
    </SettingsScroll>
  );
}
