/**
 * DebugScreen — what the Pond is doing right now, for a developer finding out why something went
 * wrong (issue #165): which model holds each job, and, as it lands, the live log and how long each
 * command took.
 *
 * Dev builds only for now, like the Developer screen it opens from. The journey gives it to a
 * developer role on test Ponds; when the Pond has roles (jarida-io/goose-in-a-pond#616), that check
 * replaces `__DEV__`.
 */

import React from 'react';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { LiveLogLines } from '@/components/patterns/live-log-lines';
import { SettingsGroup, SettingsHeader, SettingsRow } from '@/components/settings/settings-list';
import { SettingsScroll } from '@/components/settings/settings-scroll';
import { holderOf, MODEL_ROLES, titleOf } from '@/models/model-library';
import { selectionTick } from '@/services/haptics';
import { useLiveLogs } from '@/view-models/use-live-logs';
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
  const logs = useLiveLogs(true);
  const lines = logs.data.entries;

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

      <SettingsGroup title={t('debug.logs.title')} footer={t('debug.logs.footer')}>
        <SettingsRow
          label={logs.paused ? t('debug.logs.resume') : t('debug.logs.pause')}
          icon={logs.paused ? 'play' : 'pause'}
          tile="slate"
          action
          onPress={() => {
            void selectionTick();
            logs.actions.setPaused(!logs.paused);
          }}
        />
        {logs.error ? <SettingsRow label={logs.error} /> : null}
        {!logs.error && lines.length === 0 ? <SettingsRow label={t('debug.logs.empty')} /> : null}
        {lines.length > 0 ? <LiveLogLines entries={lines} /> : null}
      </SettingsGroup>
    </SettingsScroll>
  );
}
