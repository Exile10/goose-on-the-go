// How the Pond's machine is doing: its checks first, then the readings they come from.

import React from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { toneColors } from '@jarida/ink';
import { InkButton, InkEdge, InkMeter, InkSpinner, inkText, useInkTheme } from '@jarida/ink/native';

import { AdminLockView } from '@/components/pond/admin-lock';
import { SettingsGroup, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import { SettingsScroll } from '@/components/settings/settings-scroll';
import { useSettingsStyles, type SettingsColors, type SettingsMetrics, type SettingsType } from '@/components/settings/settings-theme';
import { GIcon } from '@/components/ui/g-icon';
import { Spacing } from '@/constants/spacing';
import { heatZones, sizeWords } from '@/models/pond-admin';
import type { AdminCheckId, AdminCheckStatus, AdminHealth } from '@/services/types';
import {
  checkLabel,
  checkThreshold,
  checkTone,
  checkValueWords,
  durationWords,
  healthSummaryWords,
  zoneLabel,
} from '@/view-models/pond-admin-words';
import { usePondHealth } from '@/view-models/use-pond-health';

const HEAT_COLUMNS = 2;

function Summary({ health }: { health: AdminHealth }) {
  const styles = useSettingsStyles(makeStyles);
  const theme = useInkTheme();
  const { status, title, line } = healthSummaryWords(health);
  const tone = toneColors(checkTone(status), theme.color);
  return (
    <InkEdge radius={theme.radius.lg} style={styles.section} contentStyle={styles.summary}>
      <View style={[styles.summaryTile, { backgroundColor: tone.soft }]}>
        <GIcon name={status === 'ok' ? 'check' : 'warn'} size={26} color={tone.fg} strokeWidth={2.4} />
      </View>
      <View style={styles.summaryText} accessibilityLiveRegion="polite">
        <Text style={inkText(theme, { size: 'xl', weight: theme.weight.bold, leading: 'snug' }).style} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.line}>{line}</Text>
      </View>
    </InkEdge>
  );
}

function CheckRow({ health, id, status }: { health: AdminHealth; id: AdminCheckId; status: AdminCheckStatus }) {
  const styles = useSettingsStyles(makeStyles);
  const theme = useInkTheme();
  const threshold = checkThreshold(id);
  return (
    <View style={styles.check}>
      <View style={[styles.dot, { backgroundColor: toneColors(checkTone(status), theme.color).solid }]} />
      <View style={styles.checkText}>
        <Text style={styles.label}>{checkLabel(id)}</Text>
        {threshold ? <Text style={styles.line}>{threshold}</Text> : null}
      </View>
      <Text style={styles.value}>{checkValueWords(health, id, status)}</Text>
    </View>
  );
}

export default function PondHealthScreen() {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const theme = useInkTheme();
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
          <View style={styles.failed}>
            <SettingsMessage tone="danger">{error ?? t('myPond.health.readFailed')}</SettingsMessage>
            <InkButton variant="quiet" icon="refresh" onPress={() => void actions.refresh()}>
              {t('common.retry')}
            </InkButton>
          </View>
        )}
      </SettingsScroll>
    );
  }

  const { host, memory } = health;
  const memoryUsed = memory && memory.total_bytes > 0 ? 1 - memory.available_bytes / memory.total_bytes : null;
  const swapLine =
    memory && memory.swap_total_bytes > 0
      ? t('myPond.health.swap', {
          used: sizeWords(memory.swap_total_bytes - memory.swap_free_bytes),
          total: sizeWords(memory.swap_total_bytes),
        })
      : null;
  // Most of the memory in use is the model doing its job; said so that a full meter reads as normal.
  const memoryNote = [memoryUsed !== null && memoryUsed >= 0.5 ? t('myPond.health.memoryModel') : null, swapLine].filter(Boolean).join(' ');

  const zones = heatZones(health.temperatures);
  const heatRows = Array.from({ length: Math.ceil(zones.length / HEAT_COLUMNS) }, (_, i) =>
    zones.slice(i * HEAT_COLUMNS, i * HEAT_COLUMNS + HEAT_COLUMNS),
  );

  const load = host.load.map((n) => n.toFixed(2)).join(t('myPond.dot'));
  const board = [host.os, host.arch].filter(Boolean).join(t('myPond.dot'));

  return (
    <SettingsScroll refreshControl={<RefreshControl refreshing={false} onRefresh={() => void actions.refresh()} />}>
      <Summary health={health} />

      <SettingsGroup title={t('myPond.health.checks')}>
        {health.checks.length === 0 ? <SettingsRow label={t('myPond.health.noChecks')} /> : null}
        {health.checks.map((check, i) => (
          <CheckRow key={`${check.id}:${i}`} health={health} id={check.id} status={check.status} />
        ))}
      </SettingsGroup>

      {memory && memoryUsed !== null ? (
        <SettingsGroup title={t('myPond.health.memoryTitle')}>
          <View style={styles.memory}>
            <View style={styles.figureLine}>
              <Text style={inkText(theme, { size: 'xl', weight: theme.weight.bold, leading: 'snug' }).style}>
                {t('myPond.health.memoryFree', { size: sizeWords(memory.available_bytes) })}
              </Text>
              <Text style={styles.line}>{t('myPond.health.memoryOf', { size: sizeWords(memory.total_bytes) })}</Text>
            </View>
            <InkMeter value={memoryUsed} label={t('myPond.health.memoryMeter', { percent: Math.round(memoryUsed * 100) })} />
            {memoryNote ? <Text style={styles.line}>{memoryNote}</Text> : null}
          </View>
        </SettingsGroup>
      ) : null}

      {heatRows.length > 0 ? (
        <SettingsGroup title={t('myPond.health.heat')}>
          <View style={styles.heat}>
            {heatRows.map((row, i) => (
              <View key={i} style={styles.heatRow}>
                {row.map((zone) => (
                  <View key={zone.zone} style={[styles.heatTile, { backgroundColor: theme.color.content, borderRadius: theme.radius.md }]}>
                    <Text style={styles.heatName}>{zoneLabel(zone.zone)}</Text>
                    <Text style={[inkText(theme, { size: 'lg', weight: theme.weight.bold }).style, styles.figure]}>
                      {t('myPond.health.celsius', { value: zone.celsius.toFixed(1) })}
                    </Text>
                  </View>
                ))}
                {row.length < HEAT_COLUMNS ? <View style={styles.heatSpacer} /> : null}
              </View>
            ))}
          </View>
        </SettingsGroup>
      ) : null}

      <SettingsGroup title={t('myPond.health.computer')}>
        {host.uptime_secs !== null ? <SettingsRow label={t('myPond.health.upFor')} value={durationWords(host.uptime_secs)} /> : null}
        {load ? (
          <SettingsRow
            label={t('myPond.health.busy')}
            value={host.cpus !== null ? t('myPond.health.busyOf', { load, cpus: host.cpus }) : load}
          />
        ) : null}
        {board ? <SettingsRow label={t('myPond.health.board')} value={board} /> : null}
      </SettingsGroup>
    </SettingsScroll>
  );
}

const makeStyles = (c: SettingsColors, type: SettingsType, m: SettingsMetrics) => ({
  failed: { alignItems: 'center' as const, gap: Spacing.md },
  section: { marginBottom: Spacing.xl },
  summary: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.md + 2, padding: Spacing.lg + 2 },
  summaryTile: { width: 48, height: 48, borderRadius: m.radius.lg, alignItems: 'center' as const, justifyContent: 'center' as const },
  summaryText: { flex: 1, gap: 2 },
  line: { ...type.description, flexShrink: 1 },
  check: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Spacing.md,
    minHeight: 52,
    paddingHorizontal: m.rowH,
    paddingVertical: m.rowV,
  },
  dot: { width: 10, height: 10, borderRadius: m.radius.pill },
  checkText: { flex: 1, gap: 2 },
  label: type.label,
  value: { ...type.value, fontVariant: ['tabular-nums' as const] },
  memory: { gap: Spacing.sm + 2, paddingHorizontal: m.rowH, paddingTop: Spacing.sm, paddingBottom: m.rowH },
  figureLine: { flexDirection: 'row' as const, alignItems: 'baseline' as const, justifyContent: 'space-between' as const, gap: Spacing.sm },
  figure: { fontVariant: ['tabular-nums' as const] },
  heat: { gap: Spacing.sm + 2, paddingHorizontal: m.rowH, paddingTop: Spacing.sm, paddingBottom: m.rowH },
  heatRow: { flexDirection: 'row' as const, gap: Spacing.sm + 2 },
  heatTile: { flex: 1, paddingVertical: Spacing.sm + 2, paddingHorizontal: Spacing.md },
  heatSpacer: { flex: 1 },
  heatName: { ...type.description, color: c.textSecondary },
});
