/**
 * Choosing which model does one job. Only models on the Pond that can do the job are offered; the
 * rest are a download away.
 */

import React from 'react';
import { ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InkNotice } from '@jarida/ink/native';

import { RadioRow } from '@/components/settings/setting-controls';
import { SettingsGroup, SettingsHeader, SettingsRow, TILE_INSET } from '@/components/settings/settings-list';
import { useSettingsColors } from '@/components/settings/settings-theme';
import { Spacing } from '@/constants/spacing';
import { candidatesFor, formatMegabytes, MODEL_ROLES, titleOf } from '@/models/model-library';
import { selectionTick } from '@/services/haptics';
import type { ModelRole } from '@/services/types';
import { roleLabelKey, useModelLibrary } from '@/view-models/use-model-library';

export default function ModelRoleScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useSettingsColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ role?: string }>();
  const role: ModelRole = MODEL_ROLES.includes(params.role as ModelRole) ? (params.role as ModelRole) : 'chat';
  const lib = useModelLibrary();
  const candidates = candidatesFor(lib.models, role);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.page }}
      contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: insets.bottom + Spacing['4xl'] }}
    >
      <SettingsHeader icon="models" tile="purple" title={t(roleLabelKey(role))} description={t('models.library.footer.jobs')} />
      {lib.notice ? <InkNotice tone={lib.notice.tone === 'danger' ? 'danger' : 'neutral'}>{lib.notice.text}</InkNotice> : null}
      <SettingsGroup>
        {candidates.length === 0 ? <SettingsRow label={t('models.library.noCandidates')} /> : null}
        {candidates.map((m) => (
          <RadioRow
            key={m.id}
            label={titleOf(m)}
            description={[formatMegabytes(m.size_mb), m.engine?.label].filter(Boolean).join(' · ') || null}
            selected={m.active}
            disabled={lib.busy !== null}
            onSelect={() => {
              if (m.active) return;
              void selectionTick();
              void lib.actions.activate(m);
            }}
          />
        ))}
      </SettingsGroup>
      <SettingsGroup inset={TILE_INSET}>
        <SettingsRow
          label={t('models.library.catalog')}
          icon="download"
          tile="blue"
          accessory="next"
          onPress={() => {
            void selectionTick();
            router.push('/(stack)/settings-model-catalog');
          }}
        />
      </SettingsGroup>
    </ScrollView>
  );
}
