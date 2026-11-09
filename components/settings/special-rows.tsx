/**
 * Settings rows that read more than one field, or a list from elsewhere on the Pond.
 */

import React, { useCallback, useState } from 'react';
import { Platform, Pressable, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Spacing } from '@/constants/spacing';
import {
  describeVoice,
  formatRetentionOverrides,
  parseRetentionOverrides,
  postureOf,
  splitCategories,
  voiceInUse,
  zoneCity,
} from '@/models/pond-settings';
import { useConfirm } from '@/providers/confirm-provider';
import { selectionTick, tap } from '@/services/haptics';
import type { PondSettings } from '@/services/types';
import {
  llmModels,
  providerChoices,
  useDetectLocation,
  useModelChoices,
  useProfileChoices,
  useResetWakeWord,
  useRetitle,
  voiceLanguageKey,
} from '@/view-models/use-settings-extras';
import type { UsePondSettings } from '@/view-models/use-pond-settings';
import { usePhoneAssistant } from '@/view-models/use-phone-assistant';
import { usePhoneWake } from '@/view-models/use-phone-wake';
import { MenuRow, SwitchRow, TextRow } from './setting-controls';
import { RowSeparator, SettingsMessage, SettingsRow } from './settings-list';
import { useSettingsColors, useSettingsStyles, type SettingsColors, type SettingsMetrics, type SettingsType } from './settings-theme';

export interface SpecialProps {
  settings: PondSettings;
  vm: UsePondSettings;
}

/** The voice Goose speaks in, as a household names it: "Heart · American English". */
export function voiceName(id: string, t: TFunction): string {
  const info = describeVoice(voiceInUse(id));
  return info.language ? `${info.name} · ${t(voiceLanguageKey(info.language))}` : info.name;
}

/** An action that reads like a link: accent text, no chevron, for a button inside a group. */
function ActionRow({ label, busyLabel, busy, message, tone, onPress }: {
  label: string;
  busyLabel: string;
  busy: boolean;
  message: string | null;
  tone: 'neutral' | 'danger';
  onPress: () => void;
}) {
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      style={({ pressed }) => [styles.action, pressed && { backgroundColor: colors.pressed }]}
    >
      <Text style={styles.actionLabel}>{busy ? busyLabel : label}</Text>
      {message ? (
        <Text style={[styles.actionNote, tone === 'danger' && { color: colors.danger }]} accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function WakeWordResetRow({ settings, vm }: SpecialProps) {
  const { t } = useTranslation();
  const colors = useSettingsColors();
  const styles = useSettingsStyles(makeStyles);
  const confirm = useConfirm();
  const reset = useResetWakeWord();
  const count = settings.voice_wake_word_transcriptions.length;
  const confirmClear = useCallback(async () => {
    const yes = await confirm({
      title: t('settings.wake.clearTitle'),
      message: t('settings.wake.clearBody'),
      confirmLabel: t('settings.wake.clear'),
      destructive: true,
    });
    if (yes && (await reset.run())) void vm.actions.update('voice_wake_word_transcriptions', []);
  }, [confirm, reset, t, vm.actions]);
  return (
    <SettingsRow
      label={count > 0 ? t('settings.wake.learned', { count }) : t('settings.wake.none')}
      error={reset.message}
      trailing={
        count > 0 ? (
          <Pressable onPress={() => void confirmClear()} disabled={reset.busy} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.inlineAction, { color: colors.danger }]}>{t('settings.wake.clear')}</Text>
          </Pressable>
        ) : null
      }
    />
  );
}

export function TimezoneRow({ settings }: SpecialProps) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <SettingsRow
      label={t('settings.timezone.label')}
      description={t('settings.timezone.hint')}
      value={settings.timezone ? zoneCity(settings.timezone) : t('settings.notSet')}
      accessory="next"
      onPress={() => {
        void selectionTick();
        router.push('/(stack)/settings-timezone');
      }}
    />
  );
}

/** The place name, which the Pond geocodes when it is saved, and a way to find it from the phone. */
export function LocationRows({ settings, vm }: SpecialProps) {
  const { t } = useTranslation();
  const detect = useDetectLocation();
  const find = useCallback(async () => {
    void tap();
    const place = await detect.run(settings.weather_location_name);
    if (!place) return;
    if (place.name && place.name !== settings.weather_location_name) {
      await vm.actions.update('weather_location_name', place.name);
    }
    if (place.timezone && (!settings.timezone || settings.timezone === 'UTC')) {
      await vm.actions.update('timezone', place.timezone);
    }
  }, [detect, settings.timezone, settings.weather_location_name, vm.actions]);
  return (
    <>
      <TextRow
        label={t('settings.location.label')}
        description={t('settings.location.hint')}
        placeholder={t('settings.location.placeholder')}
        value={settings.weather_location_name}
        error={vm.fieldErrors.weather_location_name}
        onCommit={(next) => void vm.actions.update('weather_location_name', next)}
      />
      <RowSeparator />
      <ActionRow
        label={t('settings.location.find')}
        busyLabel={t('settings.location.finding')}
        busy={detect.busy}
        message={detect.message}
        tone={detect.tone}
        onPress={() => void find()}
      />
    </>
  );
}

export function RetitleRow() {
  const { t } = useTranslation();
  const retitle = useRetitle();
  return (
    <ActionRow
      label={t('settings.retitle.button')}
      busyLabel={t('settings.retitle.working')}
      busy={retitle.busy}
      message={retitle.message}
      tone={retitle.tone}
      onPress={() => {
        void tap();
        void retitle.run();
      }}
    />
  );
}

export function RetentionOverridesRow({ settings, vm }: SpecialProps) {
  const { t } = useTranslation();
  const [invalid, setInvalid] = useState(false);
  return (
    <TextRow
      label={t('settings.retentionOverrides.label')}
      description={t('settings.retentionOverrides.hint')}
      placeholder={t('settings.retentionOverrides.placeholder')}
      value={formatRetentionOverrides(settings.retention_events_by_category)}
      address
      error={invalid ? t('settings.retentionOverrides.invalid') : vm.fieldErrors.retention_events_by_category}
      onCommit={(next) => {
        const parsed = parseRetentionOverrides(next);
        setInvalid(!parsed);
        if (parsed) void vm.actions.update('retention_events_by_category', parsed);
      }}
    />
  );
}

export function SpeechCategoriesRow({ settings, vm }: SpecialProps) {
  const { t } = useTranslation();
  const [invalid, setInvalid] = useState(false);
  return (
    <TextRow
      label={t('settings.speechCategories.label')}
      description={t('settings.speechCategories.hint')}
      placeholder={t('settings.speechCategories.placeholder')}
      value={settings.unprompted_speech_categories}
      address
      disabled={!settings.unprompted_speech_enabled}
      error={invalid ? t('settings.speechCategories.invalid') : vm.fieldErrors.unprompted_speech_categories}
      onCommit={(next) => {
        const categories = splitCategories(next);
        setInvalid(categories.length === 0);
        if (categories.length > 0) void vm.actions.update('unprompted_speech_categories', categories.join(', '));
      }}
    />
  );
}

export function ToolModelRow({ settings, vm }: SpecialProps) {
  const { t } = useTranslation();
  const models = useModelChoices();
  const choices = [
    { value: '', label: t('settings.toolModel.none') },
    ...llmModels(models.items).map((m) => ({ value: m.name, label: m.name })),
  ];
  return (
    <MenuRow
      label={t('settings.toolModel.label')}
      description={t('settings.toolModel.hint')}
      value={settings.tool_model ?? ''}
      choices={choices}
      error={vm.fieldErrors.tool_model ?? models.error}
      onChange={(next) => void vm.actions.update('tool_model', next || null)}
    />
  );
}

export function providerLabel(provider: string, t: TFunction): string {
  switch (provider) {
    case '':
      return t('settings.provider.same');
    case 'local':
      return t('settings.provider.local');
    case 'ollama':
      return t('settings.provider.ollama');
    case 'llamafile':
      return t('settings.provider.llamafile');
    case 'mesh':
      return t('settings.provider.mesh');
    default:
      return t('settings.provider.other', { name: provider });
  }
}

export function ProviderRow({ settings, vm, field }: SpecialProps & { field: 'chat_provider' | 'llm_provider' }) {
  const { t } = useTranslation();
  const models = useModelChoices();
  const current = settings[field];
  const providers = providerChoices(models.items, settings.mesh_enabled);
  const all = ['', ...providers, ...(current && !providers.includes(current) ? [current] : [])];
  return (
    <MenuRow
      label={t(field === 'chat_provider' ? 'settings.provider.chatLabel' : 'settings.provider.llmLabel')}
      description={t(field === 'chat_provider' ? 'settings.provider.chatHint' : 'settings.provider.llmHint')}
      value={current}
      choices={all.map((p) => ({ value: p, label: providerLabel(p, t) }))}
      error={vm.fieldErrors[field] ?? models.error}
      onChange={(next) => void vm.actions.update(field, next)}
    />
  );
}

export function PrimaryProfileRow({ settings, vm }: SpecialProps) {
  const { t } = useTranslation();
  const profiles = useProfileChoices();
  const choices = [
    { value: '', label: t('settings.primaryProfile.none') },
    ...profiles.items.map((p) => ({ value: p.id, label: p.display_name })),
  ];
  return (
    <MenuRow
      label={t('settings.primaryProfile.label')}
      description={t('settings.primaryProfile.hint')}
      value={settings.primary_profile_id ?? ''}
      choices={choices}
      error={vm.fieldErrors.primary_profile_id ?? profiles.error}
      onChange={(next) => void vm.actions.update('primary_profile_id', next || null)}
    />
  );
}

/** What the Pond is doing right now, in one sentence, from the switches that decide it. */
export function PostureRow({ settings }: SpecialProps) {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const p = postureOf(settings);
  const sentence = t('settings.posture.sentence', {
    hear: t(p.listens ? 'settings.posture.hears' : 'settings.posture.hearsNothing'),
    watch: t(p.watches ? 'settings.posture.watches' : 'settings.posture.watchesNothing'),
    memory: t(p.remembers ? 'settings.posture.remembers' : 'settings.posture.forgets'),
    speak: t(p.speaksFirst ? 'settings.posture.speaksFirst' : 'settings.posture.speaksWhenSpoken'),
  });
  const reach = t(
    p.reach === 'offline' ? 'settings.posture.offline' : p.reach === 'allowlist' ? 'settings.posture.allowlist' : 'settings.posture.open',
  );
  return (
    <Text style={styles.posture} accessibilityLiveRegion="polite">
      {sentence} {reach}
    </Text>
  );
}

const makeStyles = (c: SettingsColors, type: SettingsType, m: SettingsMetrics) => ({
  action: { paddingHorizontal: m.rowH, paddingVertical: m.rowV, minHeight: m.tapMin, justifyContent: 'center' as const, gap: Spacing.xs },
  actionLabel: { ...type.label, color: c.accent },
  actionNote: type.description,
  inlineAction: type.label,
  posture: { ...type.body, paddingHorizontal: m.rowH, paddingVertical: m.rowV },
});

/**
 * Goose as this phone's assistant: whether it is, and the way to Android's own screen to choose it.
 * Android makes the choice, so the row opens that screen rather than flipping a switch.
 */
export function PhoneAssistantRow() {
  const { t } = useTranslation();
  const { data, actions } = usePhoneAssistant();
  if (!data.supported) {
    return (
      <SettingsMessage>
        {t(Platform.OS === 'android' ? 'settings.phoneAssistant.needsUpdate' : 'settings.phoneAssistant.ios')}
      </SettingsMessage>
    );
  }
  return (
    <SettingsRow
      label={t('settings.phoneAssistant.label')}
      description={t('settings.phoneAssistant.howTo')}
      value={data.held === null ? null : t(data.held ? 'settings.phoneAssistant.isGoose' : 'settings.phoneAssistant.notGoose')}
      error={data.error}
      accessory="next"
      onPress={() => {
        void selectionTick();
        void actions.choose();
      }}
    />
  );
}

/**
 * "Listen for Hey Goose": the phone's own wake word, which opens the same voice orb as the assist
 * gesture. Android only, and only where this build carries the detector.
 */
export function PhoneWakeRow() {
  const { t } = useTranslation();
  const { data, actions } = usePhoneWake();
  if (!data.supported) {
    return (
      <SettingsMessage>
        {t(Platform.OS === 'android' ? 'settings.phoneWake.unsupported' : 'settings.phoneWake.ios')}
      </SettingsMessage>
    );
  }
  return (
    <SwitchRow
      label={t('settings.phoneWake.label')}
      description={t('settings.phoneWake.description')}
      value={data.on}
      disabled={data.busy}
      error={data.error}
      onChange={(next) => void actions.set(next)}
    />
  );
}
