/**
 * Models the Pond knows about but does not have, by job, each a tap from downloading.
 */

import React, { useMemo } from 'react';
import { RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { SettingsGroup, SettingsHeader, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import { SettingsScroll } from '@/components/settings/settings-scroll';
import { formatMegabytes, isDownloaded, MODEL_ROLES, roleOf, titleOf, tooBig } from '@/models/model-library';
import { selectionTick } from '@/services/haptics';
import { roleLabelKey, useModelLibrary } from '@/view-models/use-model-library';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

export default function ModelCatalogScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const lib = useModelLibrary();
  const pull = usePullToRefresh(lib.actions.refresh);
  const offPond = useMemo(() => lib.models.filter((m) => !isDownloaded(m)), [lib.models]);

  return (
    <SettingsScroll refreshControl={<RefreshControl {...pull} />}>
      <SettingsHeader icon="download" tile="blue" title={t('models.library.catalog')} description={t('models.library.footer.recommended')} />
      {offPond.length === 0 ? <SettingsMessage>{lib.loaded ? t('models.library.noResults') : t('settings.loading')}</SettingsMessage> : null}
      {MODEL_ROLES.map((role) => {
        const models = offPond.filter((m) => roleOf(m) === role && m.category !== 'tts');
        if (models.length === 0) return null;
        return (
          <SettingsGroup key={role} title={t(roleLabelKey(role))}>
            {models.map((m) => (
              <SettingsRow
                key={m.id}
                label={titleOf(m)}
                description={[formatMegabytes(m.size_mb), m.engine?.label, m.available === false ? t('models.library.unavailable') : tooBig(m, lib.memory?.budget_mb) ? t('models.library.tooBig') : null]
                  .filter(Boolean)
                  .join(' · ') || null}
                accessory="next"
                onPress={() => {
                  void selectionTick();
                  router.push({ pathname: '/(stack)/settings-model', params: { id: m.id } } as never);
                }}
              />
            ))}
          </SettingsGroup>
        );
      })}
    </SettingsScroll>
  );
}
