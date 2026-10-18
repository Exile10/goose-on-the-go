// The wake phrase, and teaching the Pond how this person says it, from takes recorded on this phone.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkFormField, InkInput, InkMeter, InkNotice, InkRadioGroup, InkSpinner, InkText, InkTitle } from '@jarida/ink/native';

import { Spacing } from '@/constants/spacing';
import { WAKE_PRESETS, shortPhraseSuggestion, wakePhrase, wakePhraseProblem, type WakePreset } from '@/models/owner-setup';
import type { TranslationKey } from '@/services/i18n';
import type { UseOwnerSetup } from '@/view-models/use-owner-setup';
import { useWakeCalibration } from '@/view-models/use-wake-calibration';

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

function Calibration({ phrase }: { phrase: string }) {
  const { t } = useTranslation();
  const cal = useWakeCalibration(phrase);
  const active = cal.state === 'listening' || cal.state === 'recording' || cal.state === 'sending';
  const startLabel = cal.state === 'done' ? t('setup.wake.calibrate.again') : cal.taken > 0 ? t('setup.wake.calibrate.resume') : t('setup.wake.calibrate.start');

  return (
    <InkCard raised={false} contentStyle={styles.card}>
      <InkTitle level={3}>{t('setup.wake.calibrate.title')}</InkTitle>
      <InkText tone="secondary">{t('setup.wake.calibrate.body')}</InkText>
      {active && cal.prompt ? (
        <View style={styles.take} accessibilityLiveRegion="polite">
          <InkText size="sm" tone="tertiary">
            {t('setup.wake.calibrate.take', { step: Math.min(cal.taken + 1, cal.target), count: cal.target })}
          </InkText>
          <InkText size="sm" tone="secondary">
            {t('setup.wake.calibrate.say')}
          </InkText>
          <InkText size="lg" weight="semibold">{`“${cal.prompt}”`}</InkText>
          {cal.state === 'sending' ? (
            <InkSpinner label={t('setup.wake.calibrate.sending')} />
          ) : (
            <InkMeter value={cal.level} label={t('setup.wake.calibrate.listening')} />
          )}
        </View>
      ) : null}
      {cal.state === 'done' ? (
        <InkNotice tone="success">
          {cal.heard.length > 1 ? t('setup.wake.calibrate.done', { count: cal.heard.length }) : t('setup.wake.calibrate.doneOne')}
        </InkNotice>
      ) : null}
      {cal.error ? <InkNotice tone="warning">{cal.error}</InkNotice> : null}
      <View style={styles.calActions}>
        {active ? (
          <InkButton variant="quiet" icon="stop" onPress={cal.stop}>
            {t('setup.wake.calibrate.stop')}
          </InkButton>
        ) : (
          <InkButton variant="quiet" icon="mic" disabled={!phrase} onPress={() => void cal.start()}>
            {startLabel}
          </InkButton>
        )}
      </View>
    </InkCard>
  );
}

export function WakeStep({ setup }: { setup: UseOwnerSetup }) {
  const { t } = useTranslation();
  const { draft, actions } = setup;
  const custom = draft.wakeWord === 'custom';
  const typed = draft.wakeWordCustom.trim();
  const problem = custom && typed ? wakePhraseProblem(typed) : null;
  const suggestion = custom && typed ? shortPhraseSuggestion(typed) : null;
  const preset = (WAKE_PRESETS as readonly string[]).includes(draft.wakeWord) ? (draft.wakeWord as WakePreset) : 'goose';
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
          onChange={(wakeWord) => actions.patch({ wakeWord })}
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
            onChange={(wakeWordCustom) => actions.patch({ wakeWordCustom })}
          />
        </InkFormField>
      ) : null}
      {/* A different phrase is a different calibration, so it starts again from nothing. */}
      <Calibration key={phrase} phrase={phrase} />
    </>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.sm },
  card: { gap: Spacing.md },
  take: { gap: Spacing.sm },
  calActions: { flexDirection: 'row', justifyContent: 'flex-start' },
});
