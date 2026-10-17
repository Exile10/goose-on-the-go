// The setup steps that are forms and nothing else; the voice and the wake word have files of their own.

import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  InkAvatar,
  InkButton,
  InkFormField,
  InkGroup,
  InkInput,
  InkNotice,
  InkRow,
  InkSelect,
  InkStepper,
  InkText,
  InkTitle,
} from '@jarida/ink/native';

import { Spacing } from '@/constants/spacing';
import { describeVoice } from '@/models/pond-settings';
import { SETUP_LANGUAGES, stepLabelKey, wakePhrase, type PromptStyle, type SetupStep } from '@/models/owner-setup';
import { useTheme } from '@/providers/theme-provider';
import { selectionTick } from '@/services/haptics';
import type { TranslationKey } from '@/services/i18n';
import type { UseOwnerSetup } from '@/view-models/use-owner-setup';
import { CheckRow } from './setup-chrome';
import { BirthdayField, ZoneField } from './setup-fields';

function stepNoteKey(step: SetupStep): TranslationKey | null {
  switch (step) {
    case 'about-you':
      return 'setup.stepNotes.aboutYou';
    case 'locale':
      return 'setup.stepNotes.locale';
    case 'personality':
      return 'setup.stepNotes.personality';
    case 'wake-word':
      return 'setup.stepNotes.wakeWord';
    case 'complete':
      return 'setup.stepNotes.complete';
    default:
      return null;
  }
}

export function styleLabelKey(style: PromptStyle | string): TranslationKey {
  switch (style) {
    case 'concise':
      return 'setup.personality.styles.concise';
    case 'technical':
      return 'setup.personality.styles.technical';
    case 'warm':
      return 'setup.personality.styles.warm';
    default:
      return 'setup.personality.styles.balanced';
  }
}

function StepHead({ title, lead }: { title: string; lead: string }) {
  return (
    <View style={styles.head}>
      <InkTitle level={2}>{title}</InkTitle>
      <InkText tone="secondary">{lead}</InkText>
    </View>
  );
}

const OVERVIEW: SetupStep[] = ['about-you', 'locale', 'personality', 'wake-word', 'complete'];

export function WelcomeStep({ setup }: { setup: UseOwnerSetup }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const router = useRouter();
  const { system, saving, actions } = setup;
  return (
    <View style={styles.welcome}>
      <Image
        source={isDark ? require('@/assets/images/logo-dark.png') : require('@/assets/images/logo.png')}
        style={styles.mark}
        resizeMode="contain"
      />
      <InkTitle level={1}>{t('setup.welcome.title')}</InkTitle>
      <InkText>{t('setup.welcome.body')}</InkText>
      {system ? (
        <InkGroup title={t('setup.welcome.pond')} raised={false}>
          <InkRow label={t('setup.welcome.pondName')}>
            <InkText mono tone="secondary">
              {system.hostname}
            </InkText>
          </InkRow>
          {system.version ? (
            <InkRow divided label={t('setup.welcome.pondVersion')}>
              <InkText mono tone="secondary">
                {system.version}
              </InkText>
            </InkRow>
          ) : null}
        </InkGroup>
      ) : null}
      <InkStepper
        label={t('setup.welcome.overview')}
        orientation="vertical"
        current={0}
        steps={OVERVIEW.map((step) => {
          const note = stepNoteKey(step);
          return { key: step, label: t(stepLabelKey(step)), description: note ? t(note) : undefined };
        })}
      />
      <View style={styles.actions}>
        <InkButton variant="primary" block disabled={saving} onPress={() => void actions.start()}>
          {t('setup.welcome.start')}
        </InkButton>
        <InkButton variant="quiet" block onPress={() => router.push('/(stack)/switch-pond')}>
          {t('setup.welcome.other')}
        </InkButton>
      </View>
    </View>
  );
}

export function AboutStep({ setup }: { setup: UseOwnerSetup }) {
  const { t } = useTranslation();
  const { draft, actions } = setup;
  const shownName = draft.preferredName.trim() || draft.userName.trim();
  return (
    <>
      <StepHead title={t('setup.about.title')} lead={t('setup.about.lead')} />
      <View style={styles.avatarRow}>
        <InkAvatar name={shownName} size={56} />
        <View style={styles.fill}>
          <InkFormField label={t('setup.about.name')} required>
            <InkInput
              label={t('setup.about.name')}
              placeholder={t('setup.about.namePlaceholder')}
              value={draft.userName}
              onChange={(userName) => actions.patch({ userName })}
            />
          </InkFormField>
        </View>
      </View>
      <InkFormField label={t('setup.about.preferred')} hint={t('setup.about.preferredHint')}>
        <InkInput
          label={t('setup.about.preferred')}
          value={draft.preferredName}
          onChange={(preferredName) => actions.patch({ preferredName })}
        />
      </InkFormField>
      <InkFormField label={t('setup.about.birthday')} hint={t('setup.about.birthdayHint')}>
        <BirthdayField value={draft.birthday} onChange={(birthday) => actions.patch({ birthday })} />
      </InkFormField>
      <InkGroup title={t('setup.about.speech')} raised={false}>
        <CheckRow
          label={t('setup.about.atypical')}
          description={t('setup.about.atypicalBody')}
          checked={draft.atypicalSpeech}
          onChange={(atypicalSpeech) => actions.patch({ atypicalSpeech })}
        />
        <CheckRow
          divided
          label={t('setup.about.slow')}
          description={t('setup.about.slowBody')}
          checked={draft.slowSpeech}
          onChange={(slowSpeech) => actions.patch({ slowSpeech })}
        />
      </InkGroup>
      <InkText size="sm" tone="tertiary">
        {t('setup.about.speechHint')}
      </InkText>
    </>
  );
}

export function LocaleStep({ setup }: { setup: UseOwnerSetup }) {
  const { t } = useTranslation();
  const { draft, place, actions } = setup;
  return (
    <>
      <StepHead title={t('setup.locale.title')} lead={t('setup.locale.lead')} />
      <InkFormField label={t('setup.locale.language')}>
        <InkSelect
          label={t('setup.locale.language')}
          value={draft.language}
          options={SETUP_LANGUAGES.map((l) => ({ value: l.key, label: l.name }))}
          onChange={(language) => {
            void selectionTick();
            actions.patch({ language });
          }}
        />
      </InkFormField>
      <InkFormField label={t('setup.locale.zone')} required>
        <ZoneField value={draft.timezone} onChange={(timezone) => actions.patch({ timezone })} />
      </InkFormField>
      <InkFormField label={t('setup.locale.place')} hint={t('setup.locale.placeHint')}>
        <InkInput
          label={t('setup.locale.place')}
          placeholder={t('setup.locale.placePlaceholder')}
          value={draft.locationName}
          // A typed place replaces the detected one, coordinates and all; the Pond geocodes it on save.
          onChange={(locationName) => actions.patch({ locationName, latitude: 0, longitude: 0 })}
        />
        <View style={styles.detect}>
          <InkButton variant="quiet" icon="globe" disabled={place.busy} onPress={() => void actions.detectPlace()}>
            {place.busy ? t('setup.locale.detecting') : t('setup.locale.detect')}
          </InkButton>
        </View>
        {place.note ? <InkNotice tone={place.tone === 'danger' ? 'warning' : 'neutral'}>{place.note}</InkNotice> : null}
      </InkFormField>
      <InkGroup title={t('setup.locale.weather')} raised={false}>
        <CheckRow
          label={t('setup.locale.weather')}
          description={t('setup.locale.weatherBody')}
          checked={draft.enableWeather}
          onChange={(enableWeather) => actions.patch({ enableWeather })}
        />
      </InkGroup>
    </>
  );
}

export function CompleteStep({ setup }: { setup: UseOwnerSetup }) {
  const { t } = useTranslation();
  const { draft, noChatModel, actions } = setup;
  const language = SETUP_LANGUAGES.find((l) => l.key === draft.language)?.name ?? draft.language;
  const rows: { key: string; label: string; value: string }[] = [
    { key: 'you', label: t('setup.complete.you'), value: draft.preferredName.trim() || draft.userName.trim() },
    { key: 'language', label: t('setup.complete.language'), value: language },
    { key: 'zone', label: t('setup.complete.zone'), value: draft.timezone.replace(/_/g, ' ') },
    { key: 'style', label: t('setup.complete.style'), value: t(styleLabelKey(draft.promptStyle)) },
    { key: 'assistant', label: t('setup.complete.assistant'), value: `${draft.assistantName.trim()} · ${describeVoice(draft.ttsVoice).name}` },
    { key: 'wake', label: t('setup.complete.wake'), value: wakePhrase(draft) },
  ];
  return (
    <>
      <StepHead title={t('setup.complete.title')} lead={t('setup.complete.lead')} />
      {noChatModel ? (
        <View style={styles.head} accessibilityLiveRegion="polite">
          <InkTitle level={3}>{t('setup.complete.noModelTitle')}</InkTitle>
          <InkNotice tone="warning">{t('setup.complete.noModelBody')}</InkNotice>
        </View>
      ) : null}
      <InkGroup title={t('setup.complete.memory')} raised={false}>
        <CheckRow
          label={t('setup.complete.memory')}
          description={t('setup.complete.memoryBody')}
          checked={draft.enableMemory}
          onChange={(enableMemory) => actions.patch({ enableMemory })}
        />
      </InkGroup>
      <InkGroup title={t('setup.complete.summary')} raised={false}>
        {rows.map((row, i) => (
          <InkRow key={row.key} divided={i > 0} label={row.label}>
            <InkText tone="secondary">{row.value}</InkText>
          </InkRow>
        ))}
      </InkGroup>
    </>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.sm },
  welcome: { gap: Spacing.lg },
  mark: { width: 72, height: 72, marginTop: Spacing.lg },
  actions: { gap: Spacing.sm },
  avatarRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.md },
  fill: { flex: 1 },
  detect: { alignItems: 'flex-start' },
});
