/**
 * Models: which model does each job on the Pond, what is downloading, what is on the Pond, and
 * where to get more. Laid out like iPhone Storage: what it costs first, then what holds the space.
 */

import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InkButton, InkNotice, InkSpinner } from '@jarida/ink/native';

import { DownloadRow, ModelRow } from '@/components/settings/model-rows';
import { SettingsGroup, SettingsHeader, SettingsMessage, SettingsRow, TILE_INSET } from '@/components/settings/settings-list';
import { useSettingsColors } from '@/components/settings/settings-theme';
import { voiceName } from '@/components/settings/special-rows';
import { Spacing } from '@/constants/spacing';
import {
  downloadsByModel,
  formatBytes,
  formatMegabytes,
  holderOf,
  isDownloaded,
  MODEL_ROLES,
  recommendations,
  titleOf,
} from '@/models/model-library';
import { selectionTick } from '@/services/haptics';
import type { ModelRole } from '@/services/types';
import { roleLabelKey, useModelLibrary } from '@/view-models/use-model-library';
import { usePondSettings } from '@/view-models/use-pond-settings';

function roleHintKey(role: ModelRole) {
  switch (role) {
    case 'chat':
      return 'models.library.roleHint.chat' as const;
    case 'asr':
      return 'models.library.roleHint.asr' as const;
    case 'tts':
      return 'models.library.roleHint.tts' as const;
    case 'embedding':
      return 'models.library.roleHint.embedding' as const;
  }
}

const ROLE_ICON = { chat: 'chat', asr: 'ear', tts: 'voice', embedding: 'memory' } as const;
const ROLE_TILE = { chat: 'purple', asr: 'pink', tts: 'pink', embedding: 'teal' } as const;

export default function ModelsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useSettingsColors();
  const insets = useSafeAreaInsets();
  const lib = useModelLibrary();
  const { settings } = usePondSettings();

  const downloads = useMemo(() => downloadsByModel(lib.downloads).filter((d) => d.status !== 'done' && d.status !== 'cancelled'), [lib.downloads]);
  const onPond = useMemo(() => lib.models.filter(isDownloaded), [lib.models]);
  const suggested = useMemo(() => recommendations(lib.models).slice(0, 4), [lib.models]);
  const offPond = lib.models.filter((m) => !isDownloaded(m)).length;
  const titleFor = (modelId: string) => {
    const model = lib.models.find((m) => `${m.pond_category || m.category}/${m.name}` === modelId);
    return model ? titleOf(model) : modelId.split('/').pop() ?? modelId;
  };

  const go = (pathname: string, params?: Record<string, string>) => {
    void selectionTick();
    router.push((params ? { pathname, params } : pathname) as never);
  };

  const holderText = (role: ModelRole) => {
    if (role === 'tts' && settings) return voiceName(settings.voice_tts_voice, t);
    const holder = holderOf(lib.models, role);
    return holder ? titleOf(holder) : t('models.library.nothing');
  };

  const disk = formatBytes(lib.disk?.total_bytes);
  const budget = formatMegabytes(lib.memory?.budget_mb);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.page }}
      contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: insets.bottom + Spacing['4xl'] }}
      refreshControl={<RefreshControl refreshing={lib.loading && lib.loaded} onRefresh={() => void lib.actions.refresh()} />}
    >
      <SettingsHeader
        icon="models"
        tile="purple"
        title={t('screens.models')}
        description={[t('models.library.page'), disk ? t('models.library.storage', { size: disk }) : null, budget ? t('models.library.budget', { size: budget }) : null]
          .filter(Boolean)
          .join(' ')}
      />

      {lib.notice ? (
        <View style={{ marginBottom: Spacing.lg }}>
          <InkNotice tone={lib.notice.tone === 'danger' ? 'danger' : 'neutral'}>{lib.notice.text}</InkNotice>
        </View>
      ) : null}

      {!lib.loaded ? (
        lib.error ? (
          <View style={{ alignItems: 'center', gap: Spacing.md }}>
            <SettingsMessage tone="danger">{lib.error}</SettingsMessage>
            <InkButton variant="quiet" icon="refresh" onPress={() => void lib.actions.refresh()}>
              {t('common.retry')}
            </InkButton>
          </View>
        ) : (
          <InkSpinner label={t('settings.loading')} />
        )
      ) : (
        <>
          <SettingsGroup title={t('models.library.section.jobs')} footer={t('models.library.footer.jobs')} inset={TILE_INSET}>
            {MODEL_ROLES.map((role) => (
              <SettingsRow
                key={role}
                label={t(roleLabelKey(role))}
                description={t(roleHintKey(role))}
                icon={ROLE_ICON[role]}
                tile={ROLE_TILE[role]}
                value={holderText(role)}
                accessory="next"
                onPress={() => (role === 'tts' ? go('/(stack)/settings-voice') : go('/(stack)/settings-model-role', { role }))}
              />
            ))}
          </SettingsGroup>

          {downloads.length > 0 ? (
            <SettingsGroup title={t('models.library.section.downloading')}>
              {downloads.map((d) => (
                <DownloadRow key={d.modelId} download={d} title={titleFor(d.modelId)} onControl={(action) => void lib.actions.control(d.modelId, action)} />
              ))}
            </SettingsGroup>
          ) : null}

          {suggested.length > 0 ? (
            <SettingsGroup title={t('models.library.section.recommended')} footer={t('models.library.footer.recommended')}>
              {suggested.map((m) => (
                <SettingsRow
                  key={m.id}
                  label={titleOf(m)}
                  description={[m.recommended?.reason, formatMegabytes(m.size_mb)].filter(Boolean).join(' · ')}
                  accessory="next"
                  onPress={() => go('/(stack)/settings-model', { id: m.id })}
                />
              ))}
            </SettingsGroup>
          ) : null}

          <SettingsGroup title={t('models.library.section.onPond')}>
            {onPond.length === 0 ? <SettingsRow label={t('models.library.empty')} /> : null}
            {onPond.map((m) => (
              <ModelRow key={m.id} model={m} onPress={() => go('/(stack)/settings-model', { id: m.id })} />
            ))}
          </SettingsGroup>

          <SettingsGroup title={t('models.library.section.getMore')} footer={t('models.library.footer.search')} inset={TILE_INSET}>
            <SettingsRow
              label={t('models.library.catalog')}
              icon="download"
              tile="blue"
              value={offPond > 0 ? String(offPond) : null}
              accessory="next"
              onPress={() => go('/(stack)/settings-model-catalog')}
            />
            <SettingsRow
              label={t('models.library.search')}
              icon="search"
              tile="blue"
              accessory="next"
              onPress={() => go('/(stack)/settings-model-search')}
            />
          </SettingsGroup>
        </>
      )}
    </ScrollView>
  );
}
