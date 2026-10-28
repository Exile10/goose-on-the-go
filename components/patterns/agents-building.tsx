// One card for the compile pass, so Home and the Agents screen cannot describe it differently.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkText, InkTitle } from '@jarida/ink/native';

import { ProgressBar } from '@/components/settings/model-rows';
import { Spacing } from '@/constants/spacing';
import { selectionTick } from '@/services/haptics';
import type { PrefillBuilding } from '@/services/types';
import { useAgentsBuilding } from '@/view-models/use-agent-prefills';

export function AgentsBuildingCard({
  building,
  name,
  onOpen,
}: {
  building: PrefillBuilding;
  /** The agent compiling now, in words, when the screen knows it. */
  name?: string | null;
  onOpen?: () => void;
}) {
  const { t } = useTranslation();
  const fraction = building.total > 0 ? building.done / building.total : null;
  const waiting = building.current === null && building.done === 0;
  const status = waiting ? t('agents.building.waiting') : building.current && name ? t('agents.building.current', { name }) : null;

  return (
    // Flat: a pass is news, not the thing either screen is for.
    <InkCard raised={false} contentStyle={styles.card}>
      <InkTitle level={3}>{t('agents.building.title')}</InkTitle>
      {building.total > 0 ? (
        <InkText size="sm">{t('agents.building.progress', { done: building.done, total: building.total })}</InkText>
      ) : null}
      <ProgressBar fraction={fraction} />
      {status ? (
        <InkText size="sm" tone="secondary">
          {status}
        </InkText>
      ) : null}
      <InkText size="sm" tone="secondary">
        {t('agents.building.turnsFirst')}
      </InkText>
      {onOpen ? (
        <View style={styles.actions}>
          <InkButton variant="quiet" icon="agent" onPress={onOpen}>
            {t('agents.building.open')}
          </InkButton>
        </View>
      ) : null}
    </InkCard>
  );
}

/** Home's card: shown while the Pond compiles agents, gone when it is done. */
export function AgentsGettingReady() {
  const building = useAgentsBuilding();
  const router = useRouter();
  if (!building) return null;
  return (
    <AgentsBuildingCard
      building={building}
      onOpen={() => {
        void selectionTick();
        router.push('/(stack)/agents');
      }}
    />
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
