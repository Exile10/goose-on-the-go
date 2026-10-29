// The Pond's power mode, what it draws, and restarting it. Every change asks first.

import React, { useCallback } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkSpinner } from '@jarida/ink/native';

import { AdminLockView } from '@/components/pond/admin-lock';
import { RadioRow } from '@/components/settings/setting-controls';
import { SettingsGroup, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import { SettingsNotice, SettingsScroll } from '@/components/settings/settings-scroll';
import { Spacing } from '@/constants/spacing';
import { confirm, selectionTick } from '@/services/haptics';
import type { PowerMode } from '@/services/types';
import { usePondPower } from '@/view-models/use-pond-power';

export default function PondPowerScreen() {
  const { t } = useTranslation();
  const { gate, power, fixed, rebootRequired, loading, error, notice, switching, restarting, actions } = usePondPower();

  const choose = useCallback(
    async (mode: PowerMode) => {
      void selectionTick();
      if (await actions.choose(mode)) void confirm();
    },
    [actions],
  );

  const restart = useCallback(async () => {
    if (await actions.restart()) void confirm();
  }, [actions]);

  if (gate.phase !== 'unlocked' && gate.phase !== 'checking') {
    return (
      <SettingsScroll typing>
        <AdminLockView onRetry={() => void actions.refresh()} />
      </SettingsScroll>
    );
  }

  if (loading || !power) {
    return (
      <SettingsScroll>
        {loading ? (
          <InkSpinner label={t('myPond.power.loading')} />
        ) : (
          <View>
            <SettingsMessage tone="danger">{error ?? t('myPond.power.readFailed')}</SettingsMessage>
            <InkButton variant="quiet" icon="refresh" onPress={() => void actions.refresh()}>
              {t('common.retry')}
            </InkButton>
          </View>
        )}
      </SettingsScroll>
    );
  }

  const { supply, battery } = power;

  return (
    <SettingsScroll refreshControl={<RefreshControl refreshing={false} onRefresh={() => void actions.refresh()} />}>
      <View accessibilityLiveRegion="polite">{notice ? <SettingsNotice tone="success">{notice}</SettingsNotice> : null}</View>
      {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}

      <SettingsGroup
        title={t('myPond.power.mode')}
        footer={fixed ? t('myPond.power.fixed') : t('myPond.power.modeHint')}
      >
        <SettingsRow label={t('myPond.power.current')} value={power.mode?.name ?? t('myPond.power.unknown')} />
        {fixed
          ? null
          : power.modes.map((mode) => (
              <RadioRow
                key={mode.id}
                label={switching === mode.id ? t('myPond.power.switching', { name: mode.name }) : mode.name}
                description={mode.id === power.default_mode_id ? t('myPond.power.default') : null}
                selected={mode.id === power.mode?.id}
                disabled={switching !== null}
                onSelect={() => void choose(mode)}
              />
            ))}
      </SettingsGroup>

      <SettingsGroup title={t('myPond.power.draw')}>
        {supply ? (
          <SettingsRow
            label={t('myPond.power.supply')}
            description={t('myPond.power.supplyDetail', {
              volts: (supply.millivolts / 1000).toFixed(1),
              amps: (supply.milliamps / 1000).toFixed(2),
            })}
            value={t('myPond.power.watts', { value: (supply.milliwatts / 1000).toFixed(1) })}
          />
        ) : (
          <SettingsRow label={t('myPond.power.supply')} value={t('myPond.power.notMeasured')} />
        )}
        {battery ? (
          <SettingsRow
            label={t('myPond.power.battery')}
            value={
              battery.charging
                ? t('myPond.power.charging', { percent: Math.round(battery.percent) })
                : t('myPond.power.percent', { percent: Math.round(battery.percent) })
            }
          />
        ) : null}
      </SettingsGroup>

      {fixed ? null : (
      <SettingsGroup
        title={t('myPond.power.restartTitleShort')}
        footer={rebootRequired ? t('myPond.power.rebootRequired') : t('myPond.power.restartHint')}
      >
        <View style={styles.restart}>
          <InkButton
            variant={rebootRequired ? 'primary' : 'quiet'}
            icon="restore"
            disabled={restarting}
            onPress={() => void restart()}
          >
            {restarting ? t('myPond.power.restarting') : t('myPond.power.restartPond')}
          </InkButton>
        </View>
      </SettingsGroup>
      )}
    </SettingsScroll>
  );
}

const styles = StyleSheet.create({
  restart: { alignItems: 'flex-start', padding: Spacing.lg },
});
