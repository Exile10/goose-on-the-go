// The Pond's power mode, what it draws, and restarting it. Every change asks first.

import React, { useCallback } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkBadge, InkButton, InkEdge, InkEyebrow, InkNotice, InkSpinner, inkText, useInkTheme } from '@jarida/ink/native';

import { AdminLockView } from '@/components/pond/admin-lock';
import { Radio } from '@/components/settings/setting-controls';
import { IconTile, SettingsGroup, SettingsMessage } from '@/components/settings/settings-list';
import { SettingsNotice, SettingsScroll } from '@/components/settings/settings-scroll';
import { useSettingsColors, useSettingsStyles, type SettingsColors, type SettingsMetrics, type SettingsType } from '@/components/settings/settings-theme';
import { Spacing } from '@/constants/spacing';
import { confirm, selectionTick } from '@/services/haptics';
import type { AdminPower, PowerMode } from '@/services/types';
import { powerModeWords } from '@/view-models/pond-admin-words';
import { usePondPower } from '@/view-models/use-pond-power';

function ModeCard({
  mode,
  current,
  boardDefault,
  switching,
  disabled,
  onSelect,
}: {
  mode: PowerMode;
  current: boolean;
  boardDefault: boolean;
  switching: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  const theme = useInkTheme();
  const words = powerModeWords(mode.name);
  return (
    <Pressable
      onPress={onSelect}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: current, disabled }}
      accessibilityLabel={mode.name}
      accessibilityHint={words ?? undefined}
    >
      {({ pressed }) => (
        // State is elevation: the mode the Pond is in is the one raised.
        <InkEdge
          raised={current}
          state={pressed && current ? 'pressed' : 'rest'}
          radius={theme.radius.lg}
          contentStyle={[styles.mode, pressed && !current && { backgroundColor: colors.pressed }]}
        >
          <Radio selected={current} />
          <View style={styles.modeText}>
            <View style={styles.modeName}>
              <Text style={inkText(theme, { size: 'md', weight: theme.weight.bold }).style}>
                {switching ? t('myPond.power.switching', { name: mode.name }) : mode.name}
              </Text>
              {current ? <InkBadge tone="brand">{t('myPond.power.now')}</InkBadge> : null}
              {boardDefault ? <InkBadge tone="neutral">{t('myPond.power.boardDefault')}</InkBadge> : null}
            </View>
            {words ? <Text style={styles.line}>{words}</Text> : null}
          </View>
        </InkEdge>
      )}
    </Pressable>
  );
}

function Drawing({ power }: { power: AdminPower }) {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const theme = useInkTheme();
  const { supply, battery } = power;
  const batteryWords = battery
    ? battery.charging
      ? t('myPond.power.batteryCharging', { percent: Math.round(battery.percent) })
      : t('myPond.power.battery', { percent: Math.round(battery.percent) })
    : t('myPond.power.noBattery');
  const line = supply
    ? [
        t('myPond.power.fromSupply'),
        t('myPond.power.supplyDetail', { volts: (supply.millivolts / 1000).toFixed(1), amps: (supply.milliamps / 1000).toFixed(2) }),
        batteryWords,
      ].join(t('myPond.dot'))
    : batteryWords;
  return (
    <InkEdge raised={false} radius={theme.radius.lg} style={styles.section} contentStyle={styles.drawing}>
      <IconTile icon="bolt" tile="amber" size={44} />
      <View style={styles.drawingText} accessible accessibilityLabel={t('myPond.power.drawing')}>
        <Text style={[inkText(theme, { size: 'xl', weight: theme.weight.bold, leading: 'snug' }).style, styles.figure]}>
          {supply ? t('myPond.power.watts', { value: (supply.milliwatts / 1000).toFixed(1) }) : t('myPond.power.notMeasured')}
        </Text>
        <Text style={styles.line}>{line}</Text>
      </View>
    </InkEdge>
  );
}

export default function PondPowerScreen() {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
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
          <View style={styles.failed}>
            <SettingsMessage tone="danger">{error ?? t('myPond.power.readFailed')}</SettingsMessage>
            <InkButton variant="quiet" icon="refresh" onPress={() => void actions.refresh()}>
              {t('common.retry')}
            </InkButton>
          </View>
        )}
      </SettingsScroll>
    );
  }

  // A board whose modes cannot be listed still says which one it is in.
  const modes = power.modes.length > 0 ? power.modes : power.mode ? [power.mode] : [];

  return (
    <SettingsScroll refreshControl={<RefreshControl refreshing={false} onRefresh={() => void actions.refresh()} />}>
      <View accessibilityLiveRegion="polite">{notice ? <SettingsNotice tone="success">{notice}</SettingsNotice> : null}</View>
      {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}

      <Drawing power={power} />

      <View style={styles.section} accessibilityRole="radiogroup" accessibilityLabel={t('myPond.power.mode')}>
        <View style={styles.eyebrow}>
          <InkEyebrow>{t('myPond.power.mode')}</InkEyebrow>
        </View>
        {modes.length === 0 ? <SettingsMessage>{t('myPond.power.unknown')}</SettingsMessage> : null}
        <View style={styles.modes}>
          {modes.map((mode) => (
            <ModeCard
              key={mode.id}
              mode={mode}
              current={mode.id === power.mode?.id}
              boardDefault={mode.id === power.default_mode_id}
              switching={switching === mode.id}
              disabled={fixed || switching !== null}
              onSelect={() => void choose(mode)}
            />
          ))}
        </View>
        <Text style={styles.footer}>{fixed ? t('myPond.power.fixed') : t('myPond.power.modeHint')}</Text>
      </View>

      {fixed ? null : (
        <SettingsGroup title={t('myPond.power.restartTitleShort')}>
          <View style={styles.restart}>
            <Text style={styles.prose}>{t('myPond.power.restartLine')}</Text>
            {rebootRequired ? <InkNotice tone="warning">{t('myPond.power.rebootRequired')}</InkNotice> : null}
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

const makeStyles = (c: SettingsColors, type: SettingsType, m: SettingsMetrics) => ({
  failed: { alignItems: 'center' as const, gap: Spacing.md },
  section: { marginBottom: Spacing.xl },
  drawing: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.md + 2, padding: m.rowH },
  drawingText: { flex: 1, gap: 2 },
  figure: { fontVariant: ['tabular-nums' as const] },
  line: { ...type.description, flexShrink: 1 },
  eyebrow: { paddingBottom: Spacing.sm },
  modes: { gap: Spacing.sm + 2 },
  mode: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: Spacing.md, paddingVertical: Spacing.md + 2, paddingHorizontal: m.rowH },
  modeText: { flex: 1, gap: 2 },
  modeName: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'center' as const, gap: Spacing.sm },
  footer: { ...type.prose, marginTop: Spacing.md },
  restart: { gap: Spacing.sm + 2, paddingHorizontal: m.rowH, paddingTop: Spacing.sm, paddingBottom: m.rowH },
  prose: { ...type.prose, color: c.text },
});
