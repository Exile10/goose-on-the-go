/**
 * RoutineDevices — which devices a routine switches, and to what.
 *
 * Every device the Pond can switch is listed with Leave, On and Off, so "lights
 * on and kettle on" is two taps and nothing needs adding or removing. A device
 * left as Leave is not in the routine at all.
 *
 * It reads the device list itself, so the list is only read while the form
 * showing it is open.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkFormField, InkSegmented, InkSpinner, InkText } from '@jarida/ink/native';

import { supports, useDevices } from '@/view-models/use-devices';
import { Spacing } from '@/constants/spacing';

type Choice = 'leave' | 'on' | 'off';

export function RoutineDevices({
  value,
  onChange,
}: {
  value: Record<string, boolean>;
  onChange: (devices: Record<string, boolean>) => void;
}) {
  const { t } = useTranslation();
  const { data, loading } = useDevices();
  const switchable = data.devices.filter((d) => supports(d, 'power'));

  const choose = (id: string, choice: Choice) => {
    const { [id]: _was, ...rest } = value;
    onChange(choice === 'leave' ? rest : { ...rest, [id]: choice === 'on' });
  };

  return (
    <InkFormField label={t('schedule.form.devices')}>
      {loading && switchable.length === 0 ? <InkSpinner label={t('schedule.form.devicesLoading')} /> : null}
      {!loading && switchable.length === 0 ? (
        <InkText size="sm" tone="secondary">{t('schedule.form.noSwitchable')}</InkText>
      ) : null}
      {switchable.map((d) => (
        <View key={d.id} style={styles.row}>
          <InkText>{d.name}</InkText>
          <InkSegmented<Choice>
            label={d.name}
            value={d.id in value ? (value[d.id] ? 'on' : 'off') : 'leave'}
            options={[
              { value: 'leave', label: t('schedule.form.leave') },
              { value: 'on', label: t('common.on') },
              { value: 'off', label: t('common.off') },
            ]}
            onChange={(choice) => choose(d.id, choice)}
          />
        </View>
      ))}
    </InkFormField>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.xs, paddingVertical: Spacing.xs },
});
