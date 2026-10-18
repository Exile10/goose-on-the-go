/**
 * One model: what it is and what it costs, and what can be done with it: give it its job, add
 * picture support, download it, or delete it from the Pond.
 */

import React from 'react';
import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { askToDownload, DownloadRow } from '@/components/settings/model-rows';
import { SettingsGroup, SettingsHeader, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import { SettingsNotice, SettingsScroll } from '@/components/settings/settings-scroll';
import {
  downloadsByModel,
  formatBytes,
  formatMegabytes,
  isDownloaded,
  picturesOf,
  pondModelId,
  roleOf,
  titleOf,
  tooBig,
} from '@/models/model-library';
import { caution, tap } from '@/services/haptics';
import { formatContextWindow } from '@/view-models/use-models';
import { roleLabelKey, useModelLibrary } from '@/view-models/use-model-library';

export default function ModelScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const lib = useModelLibrary();
  const model = lib.models.find((m) => m.id === id);

  if (!model) {
    return (
      <SettingsScroll>
        <SettingsMessage>{lib.loaded ? t('models.library.empty') : t('settings.loading')}</SettingsMessage>
      </SettingsScroll>
    );
  }

  const job = t(roleLabelKey(roleOf(model)));
  const size = formatMegabytes(model.size_mb);
  const downloaded = isDownloaded(model);
  const pictures = picturesOf(model);
  const download = downloadsByModel(lib.downloads).find((d) => d.modelId === pondModelId(model) && d.status !== 'done' && d.status !== 'cancelled');
  const busy = lib.busy === model.id;
  const runnable = model.available !== false;

  const askDownload = () => askToDownload(model, lib.actions.download, t);

  const askDelete = () => {
    void caution();
    Alert.alert(
      t('models.library.deleteTitle', { name: titleOf(model) }),
      size ? t('models.library.deleteBody', { size }) : t('models.library.deleteBodyNoSize'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('models.library.delete'),
          style: 'destructive',
          onPress: () => {
            void lib.actions.remove(model).then((ok) => {
              if (ok) router.back();
            });
          },
        },
      ],
    );
  };

  const facts = [
    { label: t('models.library.facts.job'), value: job },
    { label: t('models.library.facts.size'), value: size },
    { label: t('models.library.facts.memory'), value: formatMegabytes(model.ram_estimate_mb) },
    { label: t('models.library.facts.context'), value: formatContextWindow(model.context_length) },
    { label: t('models.library.facts.engine'), value: model.engine?.label ?? null },
    { label: t('models.library.facts.quantization'), value: model.quantization ?? null },
  ].filter((f) => !!f.value);

  return (
    <SettingsScroll>
      <SettingsHeader icon="models" tile="purple" title={titleOf(model)} description={model.recommended?.reason || model.description || job} />
      {lib.notice ? <SettingsNotice tone={lib.notice.tone === 'danger' ? 'danger' : 'neutral'}>{lib.notice.text}</SettingsNotice> : null}

      {download ? (
        <SettingsGroup title={t('models.library.section.downloading')}>
          <DownloadRow download={download} title={titleOf(model)} onControl={(action) => void lib.actions.control(download.modelId, action)} />
        </SettingsGroup>
      ) : null}

      <SettingsGroup title={t('models.library.section.actions')}>
        {downloaded ? (
          <SettingsRow
            label={model.active ? t('models.library.using', { job }) : t('models.library.use', { job })}
            action={!model.active}
            disabled={model.active || busy || !runnable}
            note={!runnable ? t('models.library.unavailable') : tooBig(model, lib.memory?.budget_mb) ? t('models.library.tooBig') : null}
            onPress={() => {
              void tap();
              void lib.actions.activate(model);
            }}
          />
        ) : (
          <SettingsRow
            label={size ? `${t('models.library.download')} · ${size}` : t('models.library.download')}
            action
            disabled={busy || !!download || !runnable}
            note={!runnable ? t('models.library.unavailable') : tooBig(model, lib.memory?.budget_mb) ? t('models.library.tooBig') : null}
            onPress={askDownload}
          />
        )}
        {downloaded && pictures ? (
          <SettingsRow
            label={
              pictures.state === 'installed' ? t('models.library.picturesInstalled')
                : pictures.state === 'downloading' || pictures.state === 'verifying' ? t('models.library.picturesDownloading')
                  : formatBytes(pictures.size_bytes) ? t('models.library.picturesSize', { size: formatBytes(pictures.size_bytes) }) : t('models.library.pictures')
            }
            action={pictures.state === 'available'}
            disabled={pictures.state !== 'available' || busy}
            onPress={() => {
              void tap();
              void lib.actions.addPictures(model);
            }}
          />
        ) : null}
        {downloaded ? <SettingsRow label={t('models.library.delete')} destructive disabled={busy || model.active} note={model.active ? t('models.library.inUse') : null} onPress={askDelete} /> : null}
      </SettingsGroup>

      <SettingsGroup title={t('models.library.section.facts')}>
        {facts.map((f) => (
          <SettingsRow key={f.label} label={f.label} value={f.value} />
        ))}
      </SettingsGroup>
    </SettingsScroll>
  );
}
