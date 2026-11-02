// The wake phrase, and a way into teaching the Pond how this person says it. Owner setup leaves it
// for later; Home's "Finish setting up" card opens it on its own screen.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { InkButton, InkCard, InkFormField, InkInput, InkRadioGroup, InkText, InkTitle } from '@jarida/ink/native';

import { Spacing } from '@/constants/spacing';
import { WAKE_PRESETS, shortPhraseSuggestion, wakePhrase, wakePhraseProblem, type SetupDraft, type WakePreset } from '@/models/owner-setup';
import { detectorWords, wakeReasonWords } from '@/models/voice-room';
import { selectionTick } from '@/services/haptics';
import type { TranslationKey } from '@/services/i18n';
import { useVoiceRoom } from '@/view-models/use-voice-room';

function presetKeys(preset: WakePreset): { label: TranslationKey; body: TranslationKey } {
  switch (preset) {
    case 'goose':
      return { label: 'setup.wake.presets.goose', body: 'setup.wake.presets.gooseBody' };
    case 'hey goose':
      return { label: 'setup.wake.presets.heyGoose', body: 'setup.wake.presets.heyGooseBody' };
    case 'ok computer':
      return { label: 'setup.wake.presets.okComputer', body: 'setup.wake.presets.okComputerBody' };
    case 'custom':
      return { label: 'setup.wake.presets.custom', body: 'setup.wake.presets.customBody' };
  }
}

function problemKey(problem: NonNullable<ReturnType<typeof wakePhraseProblem>>): TranslationKey {
  switch (problem) {
    case 'characters':
      return 'setup.wake.problem.characters';
    case 'length':
      return 'setup.wake.problem.length';
    case 'tooShort':
      return 'setup.wake.problem.tooShort';
  }
}

/**
 * Teaching opens "Teach Goose your voice" with the phrase chosen here, which it saves before the
 * first sentence. Below it, the detector the Pond listens with now and why.
 */
function TeachCard({ phrase }: { phrase: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const room = useVoiceRoom();
  const wake = room.room?.wake;

  return (
    <InkCard raised={false} contentStyle={styles.card}>
      <InkTitle level={3}>{t('setup.wake.teach.title')}</InkTitle>
      <InkText tone="secondary">{t('setup.wake.teach.body')}</InkText>
      {wake ? (
        <View style={styles.detector}>
          <InkText weight="semibold">{t('setup.wake.teach.listensWith', { detector: detectorWords(wake.detector) })}</InkText>
          {wakeReasonWords(wake.reason) ? (
            <InkText size="sm" tone="secondary">
              {wakeReasonWords(wake.reason)}
            </InkText>
          ) : null}
        </View>
      ) : null}
      <View style={styles.calActions}>
        <InkButton
          variant="quiet"
          icon="mic"
          disabled={!phrase}
          onPress={() => {
            void selectionTick();
            router.push({ pathname: '/teach-voice', params: { phrase, from: 'wake' } });
          }}
        >
          {t('setup.wake.teach.start')}
        </InkButton>
      </View>
    </InkCard>
  );
}

type WakeChoice = Pick<SetupDraft, 'wakeWord' | 'wakeWordCustom'>;

export function WakeStep({ draft, patch }: { draft: WakeChoice; patch: (change: Partial<WakeChoice>) => void }) {
  const { t } = useTranslation();
  const custom = draft.wakeWord === 'custom';
  const typed = draft.wakeWordCustom.trim();
  const problem = custom && typed ? wakePhraseProblem(typed) : null;
  const suggestion = custom && typed ? shortPhraseSuggestion(typed) : null;
  const preset = (WAKE_PRESETS as readonly string[]).includes(draft.wakeWord) ? (draft.wakeWord as WakePreset) : WAKE_PRESETS[0];
  const phrase = problem ? '' : wakePhrase(draft);

  return (
    <>
      <View style={styles.head}>
        <InkTitle level={2}>{t('setup.wake.title')}</InkTitle>
        <InkText tone="secondary">{t('setup.wake.lead')}</InkText>
      </View>
      <InkFormField label={t('setup.wake.phrase')}>
        <InkRadioGroup<WakePreset>
          label={t('setup.wake.phrase')}
          value={preset}
          options={WAKE_PRESETS.map((value) => {
            const keys = presetKeys(value);
            return { value, label: t(keys.label), description: t(keys.body) };
          })}
          onChange={(wakeWord) => patch({ wakeWord })}
        />
      </InkFormField>
      {custom ? (
        <InkFormField
          label={t('setup.wake.custom')}
          required
          hint={suggestion === null ? undefined : suggestion ? t('setup.wake.shortTry', { phrase: suggestion }) : t('setup.wake.short')}
        >
          <InkInput
            label={t('setup.wake.custom')}
            placeholder={t('setup.wake.customPlaceholder')}
            value={draft.wakeWordCustom}
            invalid={problem ? t(problemKey(problem)) : undefined}
            onChange={(wakeWordCustom) => patch({ wakeWordCustom })}
          />
        </InkFormField>
      ) : null}
      <TeachCard phrase={phrase} />
    </>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.sm },
  card: { gap: Spacing.md },
  calActions: { flexDirection: 'row', justifyContent: 'flex-start' },
  detector: { gap: Spacing.xs },
});
