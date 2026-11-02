// The Voice agent: the shipped agent that answers everything said out loud, at the Pond and on this
// phone. How it speaks and what it may use are edited here and saved with one button; how it sounds,
// how it hears and who it knows are pages of their own, linked from here. The room's live panel sits
// first, because it is the one part of the page that changes while you look at it.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Stack, useNavigation, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkBadge, InkButton, InkSpinner, InkText, inkText, useInkTheme } from '@jarida/ink/native';

import { RoomVoicePanel } from '@/components/patterns/room-voice';
import { FieldRow } from '@/components/settings/field-row';
import { NumberRow, RadioRow, SwitchRow } from '@/components/settings/setting-controls';
import { SettingsGroup, SettingsHeader, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import { SettingsNotice, SettingsScroll } from '@/components/settings/settings-scroll';
import { Spacing } from '@/constants/spacing';
import { canRebuild, DEFAULT_RETENTION_DAYS } from '@/models/agents';
import { detectorWords, interruptWords, maxTurnsNote, shownMaxTurns, unavailableWords, wakeReasonWords } from '@/models/voice-room';
import { useConfirm } from '@/providers/confirm-provider';
import { confirm, reject, selectionTick, tap } from '@/services/haptics';
import i18n from '@/services/i18n';
import type { VoiceThinking } from '@/services/types';
import { prefillDetail, prefillLabel, prefillTimes } from '@/view-models/agent-words';
import { usePondSettings } from '@/view-models/use-pond-settings';
import { useVoiceAgent } from '@/view-models/use-voice-agent';
import { useVoicePrints } from '@/view-models/use-voice-prints';
import { useVoiceRoom } from '@/view-models/use-voice-room';

export default function VoiceAgentScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const ask = useConfirm();
  const theme = useInkTheme();
  const vm = useVoiceAgent();
  const room = useVoiceRoom({ stream: true });
  const prints = useVoicePrints();
  const settings = usePondSettings();
  const [roomError, setRoomError] = useState<string | null>(null);
  const errorText = inkText(theme, { size: 'sm', weight: theme.weight.medium, color: theme.color.dangerFg });

  // Typed instructions and examples are slow to write again.
  const guard = vm.changed && !vm.saving;
  const letGo = useRef(false);
  useEffect(() => {
    if (!guard) return;
    return navigation.addListener('beforeRemove', (e) => {
      if (letGo.current) return;
      e.preventDefault();
      void ask({
        title: t('agents.editor.leaveTitle'),
        message: t('agents.editor.leaveBody'),
        confirmLabel: t('agents.editor.leave'),
        destructive: true,
      }).then((yes) => {
        if (!yes) return;
        letGo.current = true;
        navigation.dispatch(e.data.action);
      });
    });
  }, [ask, guard, navigation, t]);

  const go = useCallback(
    (route: '/(stack)/settings-speaking' | '/(stack)/settings-listening' | '/(stack)/voice-match' | '/(stack)/wake-word') => {
      void selectionTick();
      router.push(route);
    },
    [router],
  );

  const save = useCallback(async () => {
    void tap();
    const saved = await vm.actions.save();
    void (saved ? confirm() : reject());
  }, [vm.actions]);

  const reset = useCallback(async () => {
    const yes = await ask({
      title: t('voiceAgent.reset.title'),
      message: t('voiceAgent.reset.body'),
      confirmLabel: t('voiceAgent.reset.confirm'),
      cancelLabel: t('voiceAgent.reset.keep'),
      destructive: true,
    });
    if (!yes) return;
    const done = await vm.actions.reset();
    void (done ? confirm() : reject());
  }, [ask, t, vm.actions]);

  const rebuild = useCallback(async () => {
    void tap();
    const ok = await vm.actions.rebuild();
    void (ok ? confirm() : reject());
  }, [vm.actions]);

  const switchRoom = useCallback(
    async (on: boolean) => {
      setRoomError(null);
      const refused = await room.actions.setEnabled(on);
      if (refused) {
        void reject();
        setRoomError(refused);
      } else {
        // The switch is also a setting, which the settings pages read from their own store.
        void settings.actions.refresh();
      }
    },
    [room.actions, settings.actions],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([vm.actions.refresh(), room.actions.refresh(), prints.actions.refresh()]);
  }, [prints.actions, room.actions, vm.actions]);

  const { agent, draft, fieldErrors } = vm;
  const busy = vm.saving || vm.resetting;
  // A refusal can be marked a screen above the save button, so the button's own line says so.
  const refused = Object.keys(fieldErrors).length + Object.keys(vm.exampleErrors).length + vm.otherErrors.length > 0;
  const household = householdThinkingWords(settings.settings?.thinking_mode);
  const thinkingRows: { value: VoiceThinking; label: string; hint: string }[] = [
    { value: 'off', label: t('voiceAgent.thinks.off.label'), hint: t('voiceAgent.thinks.off.hint') },
    {
      value: 'auto',
      label: t('voiceAgent.thinks.auto.label'),
      hint: household ? t('voiceAgent.thinks.auto.hintNow', { choice: household }) : t('voiceAgent.thinks.auto.hint'),
    },
    { value: 'on', label: t('voiceAgent.thinks.on.label'), hint: t('voiceAgent.thinks.on.hint') },
  ];
  const phrase = room.room?.wake.phrase || settings.settings?.voice_wake_word || '';
  const times = agent ? prefillTimes(agent.prefill) : null;
  const known = prints.missing ? null : prints.data.known;
  const people = prints.data.members.length;

  return (
    <SettingsScroll typing refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refreshAll()} />}>
      {/* A swipe back cannot be asked about once it has started, so it waits until nothing is unsaved. */}
      <Stack.Screen options={{ gestureEnabled: !guard }} />
      <SettingsHeader icon="voice" tile="pink" title={t('screens.voiceAgent')} description={t('voiceAgent.intro')} />

      <View style={styles.block}>
        <RoomVoicePanel voice={room} />
      </View>

      <View accessibilityLiveRegion="polite">{vm.notice ? <SettingsNotice tone="success">{vm.notice}</SettingsNotice> : null}</View>

      {vm.loading && !agent ? <InkSpinner label={t('voiceAgent.loading')} /> : null}
      {vm.missing ? <SettingsNotice tone="neutral">{t('voiceAgent.missing')}</SettingsNotice> : null}
      {vm.failed ? (
        <View style={styles.centre}>
          <SettingsMessage tone="danger">{vm.error ?? t('voiceAgent.error.loadFailed')}</SettingsMessage>
          <InkButton variant="quiet" icon="refresh" onPress={() => void vm.actions.refresh()}>
            {t('common.retry')}
          </InkButton>
        </View>
      ) : null}

      {agent && draft ? (
        <>
          <SettingsGroup title={t('voiceAgent.speaks.title')} footer={t('voiceAgent.speaks.footer')}>
            {agent.edited ? (
              <SettingsRow label={t('voiceAgent.speaks.edited')} trailing={<InkBadge>{t('voiceAgent.speaks.editedBadge')}</InkBadge>} />
            ) : null}
            <FieldRow
              label={t('voiceAgent.speaks.instructions')}
              description={t('voiceAgent.speaks.instructionsHint')}
              value={draft.instructions}
              onChange={vm.actions.setInstructions}
              error={fieldErrors.instructions}
              multiline
              disabled={busy}
            />
          </SettingsGroup>

          <SettingsGroup
            title={t('voiceAgent.examples.title')}
            footer={fieldErrors.examples ?? t('voiceAgent.examples.footer')}
          >
            {draft.examples.length === 0 ? <SettingsRow label={t('voiceAgent.examples.none')} /> : null}
            {draft.examples.flatMap((example, i) => [
              <FieldRow
                key={`asked-${i}`}
                label={t('voiceAgent.examples.asked', { number: i + 1 })}
                value={example.brief}
                onChange={(brief) => vm.actions.setExample(i, { ...example, brief })}
                placeholder={t('voiceAgent.examples.askedPlaceholder')}
                error={vm.exampleErrors[`${i}.brief`]}
                disabled={busy}
              />,
              <FieldRow
                key={`answer-${i}`}
                label={t('voiceAgent.examples.answer', { number: i + 1 })}
                value={example.answer}
                onChange={(answer) => vm.actions.setExample(i, { ...example, answer })}
                placeholder={t('voiceAgent.examples.answerPlaceholder')}
                multiline
                error={vm.exampleErrors[`${i}.answer`]}
                disabled={busy}
              />,
              <SettingsRow
                key={`remove-${i}`}
                label={t('voiceAgent.examples.remove', { number: i + 1 })}
                icon="trash"
                tile="red"
                destructive
                disabled={busy}
                onPress={() => vm.actions.removeExample(i)}
              />,
            ])}
            <SettingsRow label={t('voiceAgent.examples.add')} icon="plus" tile="pink" action disabled={busy} onPress={vm.actions.addExample} />
          </SettingsGroup>

          <SettingsGroup title={t('voiceAgent.uses.title')} footer={fieldErrors.tools ?? t('voiceAgent.uses.footer')}>
            {agent.tool_groups.length === 0 ? <SettingsRow label={t('voiceAgent.uses.none')} /> : null}
            {agent.tool_groups.map((group) => (
              <SwitchRow
                key={group.group}
                label={group.label}
                value={!draft.off.includes(group.group)}
                onChange={(on) => vm.actions.setGroup(group.group, on)}
                disabled={busy}
              />
            ))}
            <NumberRow
              label={t('voiceAgent.uses.maxTurns')}
              description={t('voiceAgent.uses.maxTurnsHint')}
              note={maxTurnsNote(agent, draft)}
              value={shownMaxTurns(agent, draft)}
              min={0}
              max={12}
              step={1}
              error={fieldErrors.maxTurns}
              onCommit={vm.actions.setMaxTurns}
              disabled={busy}
            />
          </SettingsGroup>

          {draft.thinking !== null ? (
            <SettingsGroup
              title={t('voiceAgent.thinks.title')}
              footer={
                fieldErrors.thinking ??
                (settings.settings?.voice_thinking_tone_enabled === false ? t('voiceAgent.thinks.footerNoTone') : t('voiceAgent.thinks.footer'))
              }
            >
              {thinkingRows.map((row) => (
                <RadioRow
                  key={row.value}
                  label={row.label}
                  description={row.hint}
                  selected={draft.thinking === row.value}
                  disabled={busy}
                  onSelect={() => {
                    if (draft.thinking === row.value) return;
                    void selectionTick();
                    vm.actions.setThinking(row.value);
                  }}
                />
              ))}
            </SettingsGroup>
          ) : null}

          {vm.otherErrors.length > 0 ? (
            <SettingsGroup title={t('agents.editor.otherProblems')}>
              {vm.otherErrors.map((e, i) => (
                <SettingsRow key={`${e.path}:${i}`} label={e.message} description={e.path || null} />
              ))}
            </SettingsGroup>
          ) : null}

          {vm.error && !vm.failed ? (
            <Text accessibilityRole="alert" style={[errorText.style, styles.error]}>
              {vm.error}
            </Text>
          ) : null}

          <View style={styles.footer}>
            <View style={styles.state}>
              <InkText size="sm" tone="secondary">
                {vm.saving
                  ? t('agents.editor.saving')
                  : refused
                    ? t('voiceAgent.notSaved')
                    : vm.changed
                      ? t('agents.editor.unsaved')
                      : t('agents.editor.noChanges')}
              </InkText>
            </View>
            <View style={styles.actions}>
              {vm.changed ? (
                <InkButton variant="quiet" onPress={vm.actions.revert} disabled={busy}>
                  {t('voiceAgent.revert')}
                </InkButton>
              ) : null}
              <InkButton variant="primary" icon="check" onPress={() => void save()} disabled={busy || !vm.changed}>
                {t('common.save')}
              </InkButton>
            </View>
          </View>

          {agent.edited ? (
            <SettingsGroup footer={t('voiceAgent.reset.footer')}>
              <SettingsRow
                label={vm.resetting ? t('voiceAgent.reset.resetting') : t('voiceAgent.reset.row')}
                icon="restore"
                tile="red"
                destructive
                disabled={busy}
                onPress={() => void reset()}
              />
            </SettingsGroup>
          ) : null}
        </>
      ) : null}

      <SettingsGroup title={t('voiceAgent.sounds.title')}>
        <SettingsRow
          label={t('screens.settingsSpeaking')}
          description={t('voiceAgent.sounds.body')}
          icon="speaker"
          tile="pink"
          accessory="next"
          onPress={() => go('/(stack)/settings-speaking')}
        />
      </SettingsGroup>

      <SettingsGroup title={t('voiceAgent.hears.title')}>
        <SettingsRow
          label={t('voiceAgent.hears.phrase')}
          value={phrase ? `“${phrase}”` : null}
          icon="mic"
          tile="pink"
          accessory="next"
          onPress={() => go('/(stack)/wake-word')}
        />
        {room.room
          ? [
              <SettingsRow
                key="detector"
                label={t('voiceAgent.hears.detector')}
                value={detectorWords(room.room.wake.detector)}
                description={wakeReasonWords(room.room.wake.reason)}
              />,
              <SwitchRow
                key="room"
                label={t('voiceAgent.hears.room')}
                description={room.room.available ? t('voiceAgent.hears.roomHint') : unavailableWords(room.room.unavailable_reason)}
                value={room.room.enabled}
                onChange={(on) => void switchRoom(on)}
                disabled={!room.room.available || room.switching}
                error={roomError}
              />,
              <SettingsRow key="interrupts" label={t('voiceAgent.hears.interrupts')} description={interruptWords(room.room.interrupts, phrase)} />,
            ]
          : null}
        {room.missing ? <SettingsRow label={t('voiceAgent.hears.room')} description={t('voiceRoom.missing')} /> : null}
        <SettingsRow
          label={t('screens.settingsListening')}
          icon="ear"
          tile="pink"
          accessory="next"
          onPress={() => go('/(stack)/settings-listening')}
        />
      </SettingsGroup>

      <SettingsGroup title={t('voiceAgent.knows.title')} footer={t('voiceAgent.knows.footer')}>
        <SettingsRow
          label={t('screens.voiceMatch')}
          value={known === null || prints.loading ? null : t('voiceAgent.knows.count', { known, people })}
          icon="users"
          tile="pink"
          accessory="next"
          onPress={() => go('/(stack)/voice-match')}
        />
      </SettingsGroup>

      {agent ? (
        <SettingsGroup title={t('agents.editor.copyTitle')} footer={canRebuild(agent.prefill) ? t('agents.prefill.rebuildHint') : t('voiceAgent.prefill.footer')}>
          <SettingsRow
            label={prefillLabel(agent.prefill.status)}
            description={prefillDetail(agent.prefill.status, DEFAULT_RETENTION_DAYS)}
            destructive={agent.prefill.status === 'failed'}
          />
          {times ? <SettingsRow label={t('agents.prefill.compiled')} value={times.compiled || t('agents.prefill.never')} /> : null}
          {times ? <SettingsRow label={t('agents.prefill.lastUsed')} value={times.used || t('agents.prefill.never')} /> : null}
          {canRebuild(agent.prefill) ? (
            <SettingsRow
              label={vm.rebuilding ? t('agents.prefill.rebuilding') : t('agents.prefill.rebuild')}
              icon="refresh"
              tile="indigo"
              action
              disabled={vm.rebuilding || busy}
              onPress={() => void rebuild()}
            />
          ) : null}
        </SettingsGroup>
      ) : null}
    </SettingsScroll>
  );
}

/** The household's own thinking choice, as Settings > Thinking names it; null for one it does not offer. */
function householdThinkingWords(mode: string | undefined): string | null {
  switch (mode) {
    case 'auto':
      return i18n.t('settings.option.thinking_mode.auto.label');
    case 'on':
      return i18n.t('settings.option.thinking_mode.on.label');
    case 'off':
      return i18n.t('settings.option.thinking_mode.off.label');
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  block: { marginBottom: Spacing.xl },
  centre: { alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.xl },
  error: { marginBottom: Spacing.md },
  // With Undo and Save both showing, a phone has no room for the note beside them: it takes its own line.
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.md, marginBottom: Spacing.xl },
  state: { flexGrow: 1, flexBasis: 160 },
  actions: { flexDirection: 'row', gap: Spacing.md, marginLeft: 'auto' },
});
