/**
 * Rows the Models pages share: a download with its progress and controls, and a model with what it
 * costs and what it is doing.
 */

import React from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/constants/spacing';
import {
  formatBytes,
  formatMegabytes,
  fractionDone,
  picturesOf,
  roleOf,
  titleOf,
  type ModelDownload,
} from '@/models/model-library';
import { tap } from '@/services/haptics';
import type { DownloadAction, ModelEntry } from '@/services/types';
import { roleLabelKey, type UseModelLibrary } from '@/view-models/use-model-library';
import { SettingsRow } from './settings-list';
import { useSettingsColors, useSettingsStyles, type SettingsColors, type SettingsMetrics, type SettingsType } from './settings-theme';

/** A download is never started without asking: the size first, and picture support where it can come too. */
export function askToDownload(model: ModelEntry, download: UseModelLibrary['actions']['download'], t: TFunction): void {
  void tap();
  const size = formatMegabytes(model.size_mb);
  const pictures = picturesOf(model);
  const body = size ? t('models.library.downloadBody', { size }) : t('models.library.downloadBodyNoSize');
  const options = pictures && pictures.state === 'available'
    ? [
        { text: t('models.library.withPictures'), onPress: () => void download(model, true) },
        { text: t('models.library.textOnly'), onPress: () => void download(model, false) },
      ]
    : [{ text: t('models.library.download'), onPress: () => void download(model, true) }];
  Alert.alert(t('models.library.downloadTitle', { name: titleOf(model) }), body, [{ text: t('common.cancel'), style: 'cancel' }, ...options]);
}

export function ProgressBar({ fraction }: { fraction: number | null }) {
  const styles = useSettingsStyles(makeStyles);
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={fraction === null ? undefined : { min: 0, max: 100, now: Math.round(fraction * 100) }}>
      <View style={[styles.fill, { width: `${Math.round((fraction ?? 0.04) * 100)}%` }]} />
    </View>
  );
}

function ControlButton({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  return (
    <Pressable
      onPress={() => {
        void tap();
        onPress();
      }}
      hitSlop={8}
      accessibilityRole="button"
      style={({ pressed }) => [styles.control, pressed && { backgroundColor: colors.pressed }]}
    >
      <Text style={[styles.controlText, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

export function DownloadRow({
  download,
  title,
  onControl,
}: {
  download: ModelDownload;
  title: string;
  onControl: (action: DownloadAction) => void;
}) {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const done = formatBytes(download.downloaded) ?? '—';
  const total = formatBytes(download.total);
  const status =
    download.status === 'paused' ? t('models.library.paused')
      : download.status === 'error' ? (download.error ? t('models.library.failedWith', { reason: download.error }) : t('models.library.failedPlain'))
        : total ? t('models.library.progress', { done, total }) : t('models.library.progressUnknown', { done });
  return (
    <View style={styles.download} accessible accessibilityLabel={`${title}, ${status}`}>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <ProgressBar fraction={fractionDone(download)} />
      <View style={styles.downloadFoot}>
        <Text style={styles.status} accessibilityLiveRegion="polite">{status}</Text>
        <View style={styles.controls}>
          {download.status === 'downloading' ? <ControlButton label={t('models.library.pause')} onPress={() => onControl('pause')} /> : null}
          {download.status === 'paused' ? <ControlButton label={t('models.library.resume')} onPress={() => onControl('resume')} /> : null}
          {download.status === 'error' && download.resumable ? <ControlButton label={t('models.library.retry')} onPress={() => onControl('resume')} /> : null}
          {download.status !== 'done' && download.status !== 'cancelled' ? (
            <ControlButton label={t('models.library.cancel')} onPress={() => onControl('cancel')} danger />
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** A model, with its size and engine under its name, and the job it holds on the right. */
export function ModelRow({ model, onPress }: { model: ModelEntry; onPress: () => void }) {
  const { t } = useTranslation();
  const facts = [formatMegabytes(model.size_mb), model.engine?.label].filter(Boolean).join(' · ');
  return (
    <SettingsRow
      label={titleOf(model)}
      description={facts || null}
      value={model.active ? t(roleLabelKey(roleOf(model))) : null}
      accessory="next"
      onPress={onPress}
    />
  );
}

const makeStyles = (c: SettingsColors, type: SettingsType, m: SettingsMetrics) => ({
  track: {
    height: 6,
    borderRadius: m.radius.pill,
    backgroundColor: c.line,
    borderWidth: m.hairline,
    borderColor: c.edge,
    overflow: 'hidden' as const,
  },
  fill: { height: '100%' as const, backgroundColor: c.accent },
  download: { paddingHorizontal: m.rowH, paddingVertical: m.rowV, gap: Spacing.sm },
  title: type.label,
  downloadFoot: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: Spacing.sm },
  status: { ...type.mono, flex: 1 },
  controls: { flexDirection: 'row' as const, gap: Spacing.xs },
  control: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: m.radius.sm },
  controlText: { ...type.value, color: c.accent },
});
