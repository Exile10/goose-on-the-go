/**
 * DebugScreen — what the Pond is doing right now, for a developer finding out why something went
 * wrong (issue #165): which model holds each job, the live log as it lands, and how long each
 * command in the latest conversation took.
 *
 * Dev builds only for now, like the Developer screen it opens from. The journey gives it to a
 * developer role on test Ponds; when the Pond has roles (jarida-io/goose-in-a-pond#616), that check
 * replaces `__DEV__`.
 */

import React, { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { TelemetryCard, TurnsSheet } from '@/components/patterns/conversation-telemetry';
import { SettingsGroup, SettingsHeader, SettingsRow } from '@/components/settings/settings-list';
import { SettingsScroll } from '@/components/settings/settings-scroll';
import { holderOf, MODEL_ROLES, titleOf } from '@/models/model-library';
import { selectionTick } from '@/services/haptics';
import { useConversationTelemetry, useConversationTurns } from '@/view-models/use-conversation-telemetry';
import { roleLabelKey, useModelLibrary } from '@/view-models/use-model-library';

export default function DebugScreen() {
  // Kept apart from the content so its hooks run only when it renders; see DeveloperScreen.
  if (!__DEV__) return <Redirect href="/(tabs)" />;
  return <DebugScreenContent />;
}

function DebugScreenContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const lib = useModelLibrary();
  const { latest } = useConversationTelemetry().data;
  const turns = useConversationTurns();
  const [turnsOpen, setTurnsOpen] = useState(false);

  const openTurns = () => {
    if (!latest) return;
    setTurnsOpen(true);
    void turns.actions.load(latest.session.id);
  };

  return (
    <SettingsScroll>
      <SettingsHeader icon="cpu" tile="slate" title={t('screens.debug')} description={t('debug.intro')} />
      <SettingsGroup title={t('debug.models.title')}>
        {MODEL_ROLES.map((role) => {
          const holder = holderOf(lib.models, role);
          return (
            <SettingsRow
              key={role}
              label={t(roleLabelKey(role))}
              value={holder ? titleOf(holder) : t('debug.models.none')}
              accessory="next"
              onPress={() => {
                void selectionTick();
                // The voice is chosen on its own page, as from Models.
                if (role === 'tts') router.push('/(stack)/settings-speaking');
                else router.push({ pathname: '/(stack)/settings-model-role', params: { role } });
              }}
            />
          );
        })}
      </SettingsGroup>

      <SettingsGroup title={t('debug.timings.title')} footer={t('debug.timings.footer')}>
        {latest ? <TelemetryCard latest={latest} onOpen={openTurns} /> : <SettingsRow label={t('debug.timings.none')} />}
      </SettingsGroup>

      <TurnsSheet
        open={turnsOpen}
        title={latest?.session.title || t('activity.telemetry.untitled')}
        turns={turns}
        onClose={() => setTurnsOpen(false)}
        onRetry={openTurns}
      />
    </SettingsScroll>
  );
}
