// Whether the Pond's notices reached a phone and its messages were answered, over 7 or 30 days.

import React from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkBadge, InkButton, InkSegmented, InkSpinner, type InkSegmentedOption } from '@/components/ui/ink';

import { AdminLockView } from '@/components/pond/admin-lock';
import { SettingsGroup, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import { SettingsScroll } from '@/components/settings/settings-scroll';
import { useSettingsStyles, type SettingsColors, type SettingsMetrics, type SettingsType } from '@/components/settings/settings-theme';
import { Spacing } from '@/constants/spacing';
import { selectionTick } from '@/services/haptics';
import { reliabilitySections } from '@/view-models/pond-admin-words';
import { usePondReliability, type ReliabilityDays } from '@/view-models/use-pond-reliability';

export default function PondReliabilityScreen() {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const { gate, days, report, loading, error, actions } = usePondReliability();

  if (gate.phase !== 'unlocked' && gate.phase !== 'checking') {
    return (
      <SettingsScroll typing>
        <AdminLockView onRetry={() => void actions.refresh()} />
      </SettingsScroll>
    );
  }

  const periods: InkSegmentedOption<'7' | '30'>[] = [
    { value: '7', label: t('myPond.reliability.days7') },
    { value: '30', label: t('myPond.reliability.days30') },
  ];

  return (
    <SettingsScroll refreshControl={<RefreshControl refreshing={false} onRefresh={() => void actions.refresh()} />}>
      <Text style={styles.lead}>{t('myPond.reliability.lead')}</Text>
      <InkSegmented
        label={t('myPond.reliability.period')}
        value={String(days) as '7' | '30'}
        options={periods}
        onChange={(next) => {
          void selectionTick();
          actions.setDays(Number(next) as ReliabilityDays);
        }}
        style={styles.period}
      />

      {loading || (!report && !error) ? <InkSpinner label={t('myPond.reliability.loading')} /> : null}
      {!report && error ? (
        <View style={styles.failed}>
          <SettingsMessage tone="danger">{error}</SettingsMessage>
          <InkButton variant="quiet" icon="refresh" onPress={() => void actions.refresh()}>
            {t('common.retry')}
          </InkButton>
        </View>
      ) : null}

      {report
        ? reliabilitySections(report).map((section) => (
            <SettingsGroup key={section.key} title={section.title}>
              {section.rows.map((row) =>
                row.warn ? (
                  <SettingsRow
                    key={row.key}
                    label={row.label}
                    trailing={<InkBadge tone="warning">{row.value}</InkBadge>}
                    trailingLabel={row.value}
                  />
                ) : (
                  <SettingsRow key={row.key} label={row.label} value={row.value} />
                ),
              )}
            </SettingsGroup>
          ))
        : null}
    </SettingsScroll>
  );
}

const makeStyles = (_c: SettingsColors, type: SettingsType, _m: SettingsMetrics) => ({
  lead: { ...type.prose, marginBottom: Spacing.md },
  period: { marginBottom: Spacing.xl },
  failed: { alignItems: 'center' as const, gap: Spacing.md },
});
