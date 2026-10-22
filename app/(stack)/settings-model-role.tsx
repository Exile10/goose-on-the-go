/**
 * Choosing which model does one job. Only models on the Pond that can do the job are offered; the
 * rest are a download away.
 */

import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { RadioRow } from '@/components/settings/setting-controls';
import { SettingsGroup, SettingsHeader, SettingsRow, TILE_INSET } from '@/components/settings/settings-list';
import { SettingsNotice, SettingsScroll } from '@/components/settings/settings-scroll';
import { candidatesFor, formatMegabytes, MODEL_ROLES, rollbackTarget, titleOf } from '@/models/model-library';
import { selectionTick } from '@/services/haptics';
import type { ModelRole } from '@/services/types';
import { roleAboutKey, roleLabelKey, useModelLibrary } from '@/view-models/use-model-library';

export default function ModelRoleScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ role?: string }>();
  const role: ModelRole = MODEL_ROLES.includes(params.role as ModelRole) ? (params.role as ModelRole) : 'chat';
  const lib = useModelLibrary();
  const candidates = candidatesFor(lib.models, role);
  const lastWorking = rollbackTarget(lib.models, role, lib.lastWorking[role]);

  return (
    <SettingsScroll>
      <SettingsHeader icon="models" tile="purple" title={t(roleLabelKey(role))} description={t(roleAboutKey(role))} />
      {lib.notice ? <SettingsNotice tone={lib.notice.tone === 'danger' ? 'danger' : 'neutral'}>{lib.notice.text}</SettingsNotice> : null}
      {lastWorking ? (
        <SettingsGroup inset={TILE_INSET}>
          <SettingsRow
            label={t('models.library.switchBack', { name: titleOf(lastWorking) })}
            description={t('models.library.switchBackHint')}
            icon="refresh"
            tile="purple"
            action
            disabled={lib.busy !== null}
            onPress={() => {
              void selectionTick();
              void lib.actions.rollBack(role);
            }}
          />
        </SettingsGroup>
      ) : null}
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
    </SettingsScroll>
  );
}
