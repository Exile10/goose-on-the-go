/**
 * Rows the Models pages share: a download with its progress and controls, and a model with what it
 * costs and what it is doing.
 */

import { GPressable } from '@/components/ui/g-pressable';
import React from 'react';
import { Text, View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { InkBadge } from '@/components/ui/ink';

import { Spacing } from '@/constants/spacing';
import {
  formatBytes,
  formatMegabytes,
  fractionDone,
  knownUses,
  picturesOf,
  titleOf,
  usesOf,
  type ModelDownload,
} from '@/models/model-library';
import type { ChooseFn } from '@/providers/confirm-provider';
import { tap } from '@/services/haptics';
import type { DownloadAction, HelperModel, ModelEntry, ModelUse } from '@/services/types';
import { includedKey, roleLabelKey, type UseModelLibrary } from '@/view-models/use-model-library';
import { SettingsRow } from './settings-list';
import { useSettingsColors, useSettingsStyles, type SettingsColors, type SettingsMetrics, type SettingsType } from './settings-theme';

/** A download is never started without asking: the size first, and picture support where it can come too. */
export async function askToDownload(
  model: ModelEntry,
  download: UseModelLibrary['actions']['download'],
  choose: ChooseFn,
  t: TFunction,
): Promise<void> {
  void tap();
  const size = formatMegabytes(model.size_mb);
  const pictures = picturesOf(model);
  const options = pictures && pictures.state === 'available'
    ? [
        { label: t('models.library.withPictures'), value: true },
        { label: t('models.library.textOnly'), value: false },
      ]
    : [{ label: t('models.library.download'), value: true }];
  const withPictures = await choose({
    title: t('models.library.downloadTitle', { name: titleOf(model) }),
    message: size ? t('models.library.downloadBody', { size }) : t('models.library.downloadBodyNoSize'),
    options,
  });
  if (withPictures !== null) void download(model, withPictures);
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
    <GPressable feedback="none"
      onPress={() => {
        void tap();
        onPress();
      }}
      hitSlop={8}
      accessibilityRole="button"
      style={({ pressed }) => [styles.control, pressed && { backgroundColor: colors.pressed }]}
    >
      <Text style={[styles.controlText, danger && { color: colors.danger }]}>{label}</Text>
    </GPressable>
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

/** A badge per job, in the Pond's order, or nothing for a model doing none. */
function RoleBadges({ uses }: { uses: ModelUse[] }) {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  if (uses.length === 0) return null;
  return (
    <View style={styles.badges}>
      {uses.map((use) => (
        <InkBadge key={use} tone="brand">
          {t(roleLabelKey(use))}
        </InkBadge>
      ))}
    </View>
  );
}

/** What the models working beside a row add to it, one phrase each: "Pictures included". */
export function helperPhrases(helpers: HelperModel[], t: TFunction): string[] {
  return helpers.flatMap((h) => knownUses(h.uses)).map((use) => t(includedKey(use)));
}

/**
 * A model, with its size and engine under its name, what the models working beside it add, and a
 * badge for each job it is doing.
 */
export function ModelRow({ model, helpers, onPress }: { model: ModelEntry; helpers: HelperModel[]; onPress: () => void }) {
  const { t } = useTranslation();
  const facts = [formatMegabytes(model.size_mb), model.engine?.label, ...helperPhrases(helpers, t)].filter(Boolean).join(' · ');
  const uses = usesOf(model);
  return (
    <SettingsRow
      label={titleOf(model)}
      description={facts || null}
      trailing={<RoleBadges uses={uses} />}
      accessory="next"
      trailingLabel={uses.map((u) => t(roleLabelKey(u))).join(', ') || null}
      onPress={onPress}
    />
  );
}

/**
 * A model the Pond has in use that serves no row of its own, such as the camera's detector or face
 * recognition: named by the Pond where it can, else by its job. It opens what it does.
 */
export function HelperRow({ helper, onPress }: { helper: HelperModel; onPress: () => void }) {
  const { t } = useTranslation();
  const uses = knownUses(helper.uses);
  return (
    <SettingsRow
      label={helperTitle(helper, t)}
      trailing={<RoleBadges uses={uses} />}
      accessory="next"
      trailingLabel={uses.map((u) => t(roleLabelKey(u))).join(', ') || null}
      onPress={onPress}
    />
  );
}

/** A helper's name: the Pond's, else its job's, else its id. */
export function helperTitle(helper: HelperModel, t: TFunction): string {
  const job = knownUses(helper.uses)[0];
  return helper.title?.trim() || (job ? t(roleLabelKey(job)) : null) || helper.id;
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
  badges: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, justifyContent: 'flex-end' as const, gap: Spacing.xs, flexShrink: 1 },
});
