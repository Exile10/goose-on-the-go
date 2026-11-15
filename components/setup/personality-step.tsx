// How Goose talks: style, a personality hint, standing notes, its name, and the same voice picker Settings uses.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkFormField, InkInput, InkNotice, InkRadioGroup, InkSpinner, InkText, InkTextArea, InkTitle } from '@/components/ui/ink';

import { SettingsGroup } from '@/components/settings/settings-list';
import { VoicePickerView } from '@/components/settings/voice-picker';
import { Spacing } from '@/constants/spacing';
import { PROMPT_STYLES, type PromptStyle } from '@/models/owner-setup';
import { ADVISED_NOTE_LENGTH, MAX_NOTE_LENGTH } from '@/models/prompt-extras';
import type { TranslationKey } from '@/services/i18n';
import type { UseOwnerSetup } from '@/view-models/use-owner-setup';
import { usePondVoiceSample } from '@/view-models/use-pond-voice-sample';
import { useSetupVoice } from '@/view-models/use-setup-voice';
import { styleLabelKey } from './setup-steps';

function styleBodyKey(style: PromptStyle): TranslationKey {
  switch (style) {
    case 'balanced':
      return 'setup.personality.styles.balancedBody';
    case 'concise':
      return 'setup.personality.styles.conciseBody';
    case 'technical':
      return 'setup.personality.styles.technicalBody';
    case 'warm':
      return 'setup.personality.styles.warmBody';
  }
}

export function PersonalityStep({ setup }: { setup: UseOwnerSetup }) {
  const { t } = useTranslation();
  const { draft, actions } = setup;
  const voice = useSetupVoice(draft, actions.patch);
  const sample = usePondVoiceSample(draft.ttsVoice);
  const style = (PROMPT_STYLES as readonly string[]).includes(draft.promptStyle) ? (draft.promptStyle as PromptStyle) : 'balanced';

  return (
    <>
      <View style={styles.head}>
        <InkTitle level={2}>{t('setup.personality.title')}</InkTitle>
        <InkText tone="secondary">{t('setup.personality.lead')}</InkText>
      </View>
      <InkFormField label={t('setup.personality.style')}>
        <InkRadioGroup<PromptStyle>
          label={t('setup.personality.style')}
          value={style}
          options={PROMPT_STYLES.map((value) => ({ value, label: t(styleLabelKey(value)), description: t(styleBodyKey(value)) }))}
          onChange={(promptStyle) => actions.patch({ promptStyle })}
        />
      </InkFormField>
      <InkFormField label={t('setup.personality.hint')} hint={t('setup.personality.hintBody')}>
        <InkTextArea
          label={t('setup.personality.hint')}
          rows={2}
          value={draft.personality}
          onChange={(personality) => actions.patch({ personality })}
        />
      </InkFormField>
      <InkFormField label={t('setup.personality.notes')} hint={t('setup.personality.notesBody')}>
        <View style={styles.notes}>
          <InkTextArea
            label={t('setup.personality.notes')}
            placeholder={t('setup.personality.notesPlaceholder')}
            rows={3}
            maxRows={8}
            value={draft.notes}
            onChange={(notes) => actions.patch({ notes: notes.slice(0, MAX_NOTE_LENGTH) })}
          />
          {draft.notes.trim().length > ADVISED_NOTE_LENGTH ? <InkNotice tone="warning">{t('promptNotes.form.tooLong')}</InkNotice> : null}
        </View>
      </InkFormField>
      <InkFormField label={t('setup.personality.name')} required>
        <InkInput label={t('setup.personality.name')} value={draft.assistantName} onChange={(assistantName) => actions.patch({ assistantName })} />
      </InkFormField>
      <InkFormField label={t('setup.personality.voice')}>
        <SettingsGroup>
          {voice.loading ? (
            <View style={styles.loading}>
              <InkSpinner label={t('setup.personality.voiceLoading')} />
            </View>
          ) : (
            <VoicePickerView
              voices={voice.voices}
              current={draft.ttsVoice}
              pace={draft.ttsSpeed}
              applying={voice.applying}
              problem={voice.error}
              onChoose={voice.choose}
              onPace={voice.setPace}
              preview={sample}
              silentLine={t('setup.personality.noPreview')}
            />
          )}
        </SettingsGroup>
      </InkFormField>
    </>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.sm },
  notes: { gap: Spacing.sm },
  loading: { padding: Spacing.lg },
});
