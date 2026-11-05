/**
 * A model the Pond has in use that is not a catalogue row of its own, such as the camera's detector
 * or face recognition: what it does and what relies on it. There is nothing to choose here; the
 * Pond runs it while the thing that needs it is on.
 */

import React from 'react';
import { RefreshControl } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { helperTitle } from '@/components/settings/model-rows';
import { SettingsGroup, SettingsHeader, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import { SettingsScroll } from '@/components/settings/settings-scroll';
import { knownUses, pondModelId, titleOf } from '@/models/model-library';
import { helperAboutKey, helperUsedByKey, roleLabelKey, useModelLibrary } from '@/view-models/use-model-library';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

export default function ModelHelperScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const lib = useModelLibrary();
  const pull = usePullToRefresh(lib.actions.refresh);
  const helper = lib.helpers.find((h) => h.id === id);

  if (!helper) {
    return (
      <SettingsScroll refreshControl={<RefreshControl {...pull} />}>
        <SettingsMessage>{lib.loaded ? t('models.library.empty') : t('settings.loading')}</SettingsMessage>
      </SettingsScroll>
    );
  }

  const uses = knownUses(helper.uses);
  const first = uses[0];
  const title = helperTitle(helper, t);
  const served = helper.serves ? lib.models.find((m) => pondModelId(m) === helper.serves) : undefined;
  const facts = [
    { label: t('models.library.facts.job'), value: uses.map((u) => t(roleLabelKey(u))).join(', ') || null },
    { label: t('models.library.facts.usedBy'), value: served ? titleOf(served) : first ? t(helperUsedByKey(first)) : null },
  ].filter((f) => !!f.value);

  return (
    <SettingsScroll refreshControl={<RefreshControl {...pull} />}>
      <SettingsHeader icon="models" tile="purple" title={title} description={first ? t(helperAboutKey(first)) : title} />
      <SettingsGroup title={t('models.library.section.facts')}>
        {facts.map((f) => (
          <SettingsRow key={f.label} label={f.label} value={f.value} />
        ))}
      </SettingsGroup>
    </SettingsScroll>
  );
}
