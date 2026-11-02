/**
 * VoicePrintSheet -- one household member's voice, from the Pond's side: how many takes it holds,
 * recording the five sentences it learns from, recording them again, and forgetting the voice.
 *
 * The person reads to this phone, in an ordinary voice, somewhere quiet. Each take goes to the Pond
 * as it is recorded; the Pond keeps how the voice sounds and discards the recording. The sentence to
 * read and the record button are the two things here that are for doing; everything else lies flat.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkMeter, InkNotice, InkSheet, InkSpinner, InkText } from '@jarida/ink/native';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-list';
import { Spacing } from '@/constants/spacing';
import { consistencyWords } from '@/models/voice-room';
import { useConfirm } from '@/providers/confirm-provider';
import { confirm as confirmed, reject } from '@/services/haptics';
import type { VoicePrintMember } from '@/services/types';
import { useVoicePrintRecorder } from '@/view-models/use-voice-prints';

export interface VoicePrintSheetProps {
  /** The person to show; the sheet is open while there is one. */
  member: VoicePrintMember | null;
  /** The Pond's speaker model is on it, so takes can be learnt from. */
  modelReady: boolean;
  onClose: () => void;
  /** Reads the list again, once the Pond holds a take or has forgotten the voice. */
  onChanged: () => Promise<void>;
  onForget: (member: VoicePrintMember) => Promise<string | null>;
}

export function VoicePrintSheet(props: VoicePrintSheetProps) {
  const { member, onClose } = props;
  return (
    <InkSheet open={member !== null} onClose={onClose} title={member?.name ?? ''}>
      {/* Keyed by person, so a recording for one is never carried into another's sheet. */}
      {member ? <VoicePrintBody key={member.profile_id} {...props} member={member} /> : null}
    </InkSheet>
  );
}

function VoicePrintBody({ member, modelReady, onChanged, onForget }: Omit<VoicePrintSheetProps, 'member' | 'onClose'> & { member: VoicePrintMember }) {
  const { t } = useTranslation();
  const ask = useConfirm();
  const rec = useVoicePrintRecorder(member, onChanged);
  const [forgetNote, setForgetNote] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const active = rec.state === 'listening' || rec.state === 'recording' || rec.state === 'sending';
  const enrolled = rec.takes >= rec.needed;
  const steadiness = consistencyWords(rec.consistency);

  const record = useCallback(
    async (fresh: boolean) => {
      setForgetNote(null);
      if (fresh) {
        const yes = await ask({
          title: t('voiceMatch.again.title', { name: member.name }),
          message: t('voiceMatch.again.body', { name: member.name }),
          confirmLabel: t('voiceMatch.again.confirm'),
          cancelLabel: t('voiceMatch.forget.keep'),
        });
        if (!yes) return;
      }
      await rec.start(fresh);
    },
    [ask, member.name, rec, t],
  );

  const forget = useCallback(async () => {
    const yes = await ask({
      title: t('voiceMatch.forget.title', { name: member.name }),
      message: t('voiceMatch.forget.body', { name: member.name }),
      confirmLabel: t('voiceMatch.forget.confirm'),
      cancelLabel: t('voiceMatch.forget.keep'),
      destructive: true,
    });
    if (!yes) return;
    rec.stop();
    const refused = await onForget(member);
    if (refused) {
      void reject();
      setForgetNote({ tone: 'danger', text: refused });
    } else {
      void confirmed();
      setForgetNote({ tone: 'success', text: t('voiceMatch.forget.done', { name: member.name }) });
    }
  }, [ask, member, onForget, rec, t]);

  const startLabel = enrolled ? t('voiceMatch.record.again') : rec.takes > 0 ? t('voiceMatch.record.resume') : t('voiceMatch.record.start');

  return (
    <>
      <View style={styles.section}>
        <InkText>{t('voiceMatch.record.body', { name: member.name, needed: rec.needed })}</InkText>
        <InkText size="sm" tone="secondary">
          {t('voiceMatch.record.progress', { takes: Math.min(rec.takes, rec.needed), needed: rec.needed })}
        </InkText>
        {steadiness ? (
          <InkText size="sm" tone="secondary">
            {steadiness}
          </InkText>
        ) : null}
      </View>

      {active && rec.sentence ? (
        // Raised: the sentence is what the person is here to read.
        <InkCard contentStyle={styles.take}>
          <View accessibilityLiveRegion="polite" style={styles.take}>
            <InkText size="sm" tone="tertiary">
              {t('voiceMatch.record.take', { step: Math.min(rec.takes + 1, rec.needed), count: rec.needed })}
            </InkText>
            <InkText size="sm" tone="secondary">
              {t('voiceMatch.record.read')}
            </InkText>
            <InkText size="lg" weight="semibold">{`“${rec.sentence}”`}</InkText>
            {rec.state === 'sending' ? (
              <InkSpinner label={t('voiceMatch.record.sending')} />
            ) : (
              <InkMeter value={rec.level} label={t('setup.wake.calibrate.listening')} />
            )}
          </View>
        </InkCard>
      ) : null}

      {rec.state === 'done' ? (
        <InkNotice tone="success">{t('voiceMatch.record.done', { name: member.name })}</InkNotice>
      ) : null}
      {rec.error ? <InkNotice tone="warning">{rec.error}</InkNotice> : null}
      {!modelReady ? <InkNotice tone="neutral">{t('voiceMatch.record.waitForModel')}</InkNotice> : null}
      {!rec.supported ? <InkNotice tone="neutral">{t('chat.voice.needsUpdate')}</InkNotice> : null}

      <View style={styles.buttons}>
        {active ? (
          <InkButton variant="quiet" icon="stop" onPress={rec.stop}>
            {t('setup.wake.calibrate.stop')}
          </InkButton>
        ) : (
          <InkButton
            variant="primary"
            icon="mic"
            disabled={!modelReady || !rec.supported}
            onPress={() => void record(enrolled)}
          >
            {startLabel}
          </InkButton>
        )}
      </View>

      <SettingsGroup>
        <SettingsRow
          label={t('voiceMatch.forget.row')}
          description={rec.takes === 0 ? t('voiceMatch.forget.nothing') : null}
          icon="trash"
          tile="red"
          destructive
          disabled={rec.takes === 0 || active}
          onPress={() => void forget()}
        />
      </SettingsGroup>
      {forgetNote ? (
        <View accessibilityLiveRegion="polite">
          <InkNotice tone={forgetNote.tone}>{forgetNote.text}</InkNotice>
        </View>
      ) : null}

      <InkText size="sm" tone="secondary">
        {t('voiceMatch.privacy')}
      </InkText>
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.xs },
  take: { gap: Spacing.sm },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
});
