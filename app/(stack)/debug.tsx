/**
 * DebugScreen — what the Pond is doing right now, for a developer finding out why something went
 * wrong (issue #165): the debug switch, which model holds each job, the live log as it lands, and
 * how long each command in the latest conversation took.
 *
 * The debug switch comes first because it decides what the log below may show: off, members' names
 * and words read `[redacted]` there, as on any Pond; on, they read as said.
 *
 * A home Pond refuses all of it, so the screen says so and opens nothing. The Advanced page lists
 * this screen only on a test Pond; the check here covers a link that reaches it anyway. Dev builds
 * only for now, like the Developer screen it opens from. The journey gives it to a developer role
 * on test Ponds; when the Pond has roles (jarida-io/goose-in-a-pond#616), that check replaces
 * `__DEV__`.
 */

import React, { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkEmptyState, InkSpinner, InkSwitch, InkText } from '@jarida/ink/native';

import { LiveLogLines } from '@/components/patterns/live-log-lines';
import { TelemetryCard, TurnsSheet } from '@/components/patterns/conversation-telemetry';
import { SettingsGroup, SettingsHeader, SettingsRow } from '@/components/settings/settings-list';
import { SettingsScroll } from '@/components/settings/settings-scroll';
import { useConfirm } from '@/providers/confirm-provider';
import { holderOf, MODEL_ROLES, titleOf } from '@/models/model-library';
import { modelLabel } from '@/models/debug';
import { caution, confirm as confirmHaptic, selectionTick } from '@/services/haptics';
import { useDebug } from '@/view-models/use-debug';
import { useLiveLogs } from '@/view-models/use-live-logs';
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
  const ask = useConfirm();
  const lib = useModelLibrary();
  const logs = useLiveLogs(true);
  const lines = logs.data.entries;
  const { latest } = useConversationTelemetry().data;
  const turns = useConversationTurns();
  const [turnsOpen, setTurnsOpen] = useState(false);
  const debug = useDebug();

  const openTurns = () => {
    if (!latest) return;
    setTurnsOpen(true);
    void turns.actions.load(latest.session.id);
  };

  const rollbackTo = debug.data.chat?.rollback ?? null;
  const rollback = async () => {
    if (!rollbackTo) return;
    void caution();
    const yes = await ask({
      title: t('debug.model.rollbackTitle'),
      message: t('debug.model.rollbackMessage', { model: modelLabel(rollbackTo.model_id) }),
      confirmLabel: t('debug.model.rollbackConfirm'),
    });
    if (!yes) return;
    if (await debug.actions.rollback()) void confirmHaptic();
  };

  const header = <SettingsHeader icon="cpu" tile="slate" title={t('screens.debug')} description={t('debug.intro')} />;

  // Asked each time the screen opens: the same phone may be paired to a home Pond tomorrow.
  if (debug.data.testPond === null) {
    return (
      <SettingsScroll>
        {header}
        {debug.loading ? <InkSpinner label={t('debug.loading')} /> : null}
        {debug.error ? (
          <SettingsGroup>
            <SettingsRow label={debug.error} action icon="refresh" onPress={() => void debug.actions.refresh()} />
          </SettingsGroup>
        ) : null}
      </SettingsScroll>
    );
  }

  if (!debug.data.testPond) {
    return (
      <SettingsScroll>
        {header}
        <InkEmptyState icon="cpu" title={t('debug.homePond.title')}>
          <InkText>{t('debug.homePond.body')}</InkText>
        </InkEmptyState>
      </SettingsScroll>
    );
  }

  return (
    <SettingsScroll>
      {header}
      <SettingsGroup title={t('debug.switch.title')} footer={t('debug.switch.footer')}>
        <SettingsRow
          label={t('debug.switch.label')}
          description={debug.data.debug ? t('debug.switch.onHint') : t('debug.switch.offHint')}
          accessibilityRole="switch"
          accessibilityState={{ checked: debug.data.debug, busy: debug.busy.debug }}
          trailing={
            <InkSwitch
              checked={debug.data.debug}
              disabled={debug.busy.debug}
              onChange={(next) => {
                void selectionTick();
                void debug.actions.setDebug(next);
              }}
            />
          }
        />
      </SettingsGroup>

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
        {rollbackTo ? (
          <SettingsRow
            label={
              debug.busy.rollback
                ? t('debug.model.rollingBack')
                : t('debug.model.rollback', { model: modelLabel(rollbackTo.model_id) })
            }
            icon="refresh"
            action
            disabled={debug.busy.rollback}
            onPress={() => void rollback()}
          />
        ) : null}
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
