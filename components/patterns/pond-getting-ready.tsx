/**
 * Home's card for a Pond whose setup was left before it could answer. Mounted only then, so Home does
 * not read the Pond's models for anyone else; it says when Goose is ready and can then be put away.
 */

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkText, InkTitle } from '@jarida/ink/native';

import { ReadinessStatus } from '@/components/setup/setup-ready';
import { Spacing } from '@/constants/spacing';
import { useServer } from '@/providers/server-provider';
import { confirm } from '@/services/haptics';
import { usePondReadiness } from '@/view-models/use-pond-readiness';
import { markGettingReady, useGettingReady, useSetupKeptAdminKey } from '@/view-models/use-setup-gate';

function GettingReadyCard() {
  const { t } = useTranslation();
  const { profileId } = useServer();
  const ready = usePondReadiness();
  const keptAdminKey = useSetupKeptAdminKey();
  const done = ready.readiness === 'ready';

  useEffect(() => {
    if (done) void confirm();
  }, [done]);

  return (
    // Flat: Home already spends Ink's raised budget on the Pond card and the remote access offer.
    <InkCard raised={false} contentStyle={styles.card}>
      <InkTitle level={3}>{done ? t('setup.gettingReady.readyTitle') : t('setup.gettingReady.title')}</InkTitle>
      {done ? <InkText tone="secondary">{t('setup.gettingReady.readyBody')}</InkText> : <ReadinessStatus ready={ready} />}
      {keptAdminKey ? (
        <InkText size="sm" tone="secondary">
          {t('setup.gettingReady.adminKey')}
        </InkText>
      ) : null}
      {done ? (
        <View style={styles.actions}>
          <InkButton variant="quiet" onPress={() => profileId && markGettingReady(profileId, false)}>
            {t('setup.gettingReady.dismiss')}
          </InkButton>
        </View>
      ) : null}
    </InkCard>
  );
}

export function PondGettingReady() {
  return useGettingReady() ? <GettingReadyCard /> : null;
}

const styles = StyleSheet.create({
  card: { gap: Spacing.md },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
