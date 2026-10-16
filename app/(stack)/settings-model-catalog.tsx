/**
 * Models the Pond knows about but does not have, by job, each a tap from downloading.
 */

import React, { useMemo } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsGroup, SettingsHeader, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import { useSettingsColors } from '@/components/settings/settings-theme';
import { Spacing } from '@/constants/spacing';
import { formatMegabytes, isDownloaded, MODEL_ROLES, roleOf, titleOf, tooBig } from '@/models/model-library';
import { selectionTick } from '@/services/haptics';
import { roleLabelKey, useModelLibrary } from '@/view-models/use-model-library';

export default function ModelCatalogScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useSettingsColors();
  const insets = useSafeAreaInsets();
  const lib = useModelLibrary();
  const offPond = useMemo(() => lib.models.filter((m) => !isDownloaded(m)), [lib.models]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.page }}
      contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: insets.bottom + Spacing['4xl'] }}
    >
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
                description={[formatMegabytes(m.size_mb), m.available === false ? t('models.library.unavailable') : tooBig(m, lib.memory?.budget_mb) ? t('models.library.tooBig') : null]
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
    </ScrollView>
  );
}
