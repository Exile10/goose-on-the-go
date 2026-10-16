/**
 * Choosing Goose's voice: an accent, then one of that accent's voices, best-trained first, with a
 * way to hear it. A voice the Pond has not downloaded yet downloads when it is chosen.
 */

import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InkSpinner } from '@jarida/ink/native';

import { Spacing } from '@/constants/spacing';
import { describeVoice, sortVoices, VOICE_LANGUAGES, type VoiceLanguage } from '@/models/pond-settings';
import { selectionTick, tap } from '@/services/haptics';
import { usePondSettings } from '@/view-models/use-pond-settings';
import { useModelChoices, useVoicePreview, voiceChoices, voiceLanguageKey } from '@/view-models/use-settings-extras';
import { MenuRow, RadioRow } from './setting-controls';
import { SettingsGroup, SettingsHeader, SettingsMessage, SettingsRow } from './settings-list';
import { useSettingsColors } from './settings-theme';

const OTHER = 'other';

export function VoicePickerScreen() {
  const { t } = useTranslation();
  const colors = useSettingsColors();
  const insets = useSafeAreaInsets();
  const vm = usePondSettings();
  const models = useModelChoices();
  const preview = useVoicePreview();
  const current = vm.settings?.voice_tts_voice ?? '';

  const voices = useMemo(() => voiceChoices(models.items), [models.items]);
  const installed = useMemo(() => new Map(voices.map((v) => [v.id, v.installed])), [voices]);
  const infos = useMemo(() => voices.map((v) => describeVoice(v.id)), [voices]);
  const languages = useMemo(() => {
    const present = new Set(infos.map((v) => v.language ?? OTHER));
    return [...VOICE_LANGUAGES.filter((l) => present.has(l)), ...(present.has(OTHER) ? [OTHER] : [])];
  }, [infos]);

  const currentLanguage = describeVoice(current).language ?? OTHER;
  const [chosen, setChosen] = useState<VoiceLanguage | typeof OTHER | null>(null);
  const language = chosen ?? (languages.includes(currentLanguage) ? currentLanguage : languages[0] ?? OTHER);

  const inLanguage = sortVoices(infos.filter((v) => (v.language ?? OTHER) === language));
  const genderLabel = (g: 'f' | 'm' | null) => (g === 'm' ? t('settings.voice.gender.m') : g === 'f' ? t('settings.voice.gender.f') : '');

  let body: React.ReactNode;
  if (!vm.settings || (models.loading && voices.length === 0)) {
    body = vm.failed ? <SettingsMessage tone="danger">{vm.error}</SettingsMessage> : <InkSpinner label={t('settings.loading')} />;
  } else if (voices.length === 0) {
    body = <SettingsMessage>{models.error ?? t('settings.voice.noVoices')}</SettingsMessage>;
  } else {
    body = (
      <>
        <SettingsGroup>
          <MenuRow
            label={t('settings.voice.accent')}
            value={language}
            choices={languages.map((l) => ({ value: l, label: t(voiceLanguageKey(l === OTHER ? null : l)) }))}
            onChange={(next) => setChosen(next as VoiceLanguage | typeof OTHER)}
          />
        </SettingsGroup>
        <SettingsGroup
          title={t('settings.voice.voice')}
          footer={vm.voice.applying ? t('settings.voice.applying') : vm.voice.error}
        >
          {inLanguage.map((info) => {
            const detail = info.grade
              ? t('settings.voice.detail', { gender: genderLabel(info.gender), grade: info.grade })
              : genderLabel(info.gender);
            const needsDownload = installed.get(info.id) === false;
            return (
              <RadioRow
                key={info.id}
                label={info.name}
                description={[detail, needsDownload ? t('settings.voice.notInstalled') : null].filter(Boolean).join(' · ')}
                selected={info.id === current}
                onSelect={() => {
                  if (info.id === current) return;
                  void selectionTick();
                  void vm.actions.update('voice_tts_voice', info.id);
                }}
              />
            );
          })}
        </SettingsGroup>
        <SettingsGroup>
          <SettingsRow
            label={preview.busy ? t('settings.voice.previewing') : t('settings.voice.preview')}
            icon="volume"
            tile="pink"
            disabled={vm.voice.applying}
            error={preview.message}
            onPress={() => {
              void tap();
              if (preview.busy) preview.stop();
              else void preview.play();
            }}
          />
        </SettingsGroup>
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: insets.bottom + Spacing['4xl'] }}
      >
        <SettingsHeader icon="voice" tile="pink" title={t('screens.settingsVoices')} description={t('settings.page.voice')} />
        {body}
      </ScrollView>
    </View>
  );
}
