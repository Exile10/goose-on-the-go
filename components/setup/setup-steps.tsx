// About you, the setup step that is a form and nothing else; the voice and the model have files of their own.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  InkAvatar,
  InkButton,
  InkCard,
  InkFormField,
  InkGroup,
  InkInput,
  InkNotice,
  InkSelect,
  InkText,
  InkTitle,
} from '@jarida/ink/native';

import { Spacing } from '@/constants/spacing';
import { SETUP_LANGUAGES, type PromptStyle } from '@/models/owner-setup';
import { selectionTick } from '@/services/haptics';
import type { TranslationKey } from '@/services/i18n';
import type { UseOwnerSetup } from '@/view-models/use-owner-setup';
import { CheckRow } from './setup-chrome';
import { BirthdayField, ZoneField } from './setup-fields';

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
      <WhereStep setup={setup} />
    </>
  );
}

/** Where the home is, filled from this phone: there to confirm, and change if it is wrong. */
function WhereStep({ setup }: { setup: UseOwnerSetup }) {
  const { t } = useTranslation();
  const { draft, place, actions } = setup;
  return (
    <View style={styles.where}>
      <View style={styles.head}>
        <InkTitle level={3}>{t('setup.locale.title')}</InkTitle>
        <InkText tone="secondary">{t('setup.locale.fromPhone')}</InkText>
      </View>
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
      {/* One row, so no group heading: it would only repeat the row's own name. */}
      <InkCard raised={false} contentStyle={styles.flush}>
        <CheckRow
          label={t('setup.locale.weather')}
          description={t('setup.locale.weatherBody')}
          checked={draft.enableWeather}
          onChange={(enableWeather) => actions.patch({ enableWeather })}
        />
      </InkCard>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.sm },
  where: { gap: Spacing.lg, marginTop: Spacing.md },
  avatarRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.md },
  fill: { flex: 1 },
  detect: { alignItems: 'flex-start' },
  flush: { padding: 0 },
});
