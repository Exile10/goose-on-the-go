/**
 * VoicePrintSheet -- one household member's voice, from the Pond's side: how many sentences it holds,
 * how alike they sounded, teaching it the voice (or again), and forgetting it.
 *
 * Teaching opens "Teach Goose your voice" for this person, so an owner can hand the phone to someone
 * who has none of their own. The sheet is closed first: a screen pushed under an open modal is not
 * seen until it is dismissed.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkNotice, InkSheet, InkText } from '@jarida/ink/native';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-list';
import { Spacing } from '@/constants/spacing';
import { consistencyWords, memberStatus } from '@/models/voice-room';
import { useConfirm } from '@/providers/confirm-provider';
import { confirm as confirmed, reject } from '@/services/haptics';
import type { VoicePrintMember } from '@/services/types';

export interface VoicePrintSheetProps {
  /** The person to show; the sheet is open while there is one. */
  member: VoicePrintMember | null;
  onClose: () => void;
  /** Opens the teaching flow for this person. */
  onTeach: (member: VoicePrintMember) => void;
  onForget: (member: VoicePrintMember) => Promise<string | null>;
}

export function VoicePrintSheet(props: VoicePrintSheetProps) {
  const { member, onClose } = props;
  return (
    <InkSheet open={member !== null} onClose={onClose} title={member?.name ?? ''}>
      {member ? <VoicePrintBody key={member.profile_id} {...props} member={member} /> : null}
    </InkSheet>
  );
}

function VoicePrintBody({ member, onTeach, onForget }: Omit<VoicePrintSheetProps, 'member' | 'onClose'> & { member: VoicePrintMember }) {
  const { t } = useTranslation();
  const ask = useConfirm();
  const [forgetNote, setForgetNote] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const steadiness = consistencyWords(member.consistency);

  const forget = useCallback(async () => {
    const yes = await ask({
      title: t('voiceMatch.forget.title', { name: member.name }),
      message: t('voiceMatch.forget.body', { name: member.name }),
      confirmLabel: t('voiceMatch.forget.confirm'),
      cancelLabel: t('voiceMatch.forget.keep'),
      destructive: true,
    });
    if (!yes) return;
    const refused = await onForget(member);
    if (refused) {
      void reject();
      setForgetNote({ tone: 'danger', text: refused });
    } else {
      void confirmed();
      setForgetNote({ tone: 'success', text: t('voiceMatch.forget.done', { name: member.name }) });
    }
  }, [ask, member, onForget, t]);

  return (
    <>
      <View style={styles.section}>
        <InkText weight="semibold">{memberStatus(member)}</InkText>
        <InkText size="sm" tone="secondary">
          {t('voiceMatch.member.held', { takes: member.takes, needed: member.needed })}
        </InkText>
        {steadiness ? (
          <InkText size="sm" tone="secondary">
            {steadiness}
          </InkText>
        ) : null}
      </View>

      <View style={styles.section}>
        <InkText>{t('voiceMatch.teachBody', { name: member.name })}</InkText>
        <View style={styles.buttons}>
          <InkButton variant="primary" icon="mic" onPress={() => onTeach(member)}>
            {member.takes > 0 ? t('voiceMatch.teachAgain') : t('voiceMatch.teach')}
          </InkButton>
        </View>
      </View>

      <SettingsGroup>
        <SettingsRow
          label={t('voiceMatch.forget.row')}
          description={member.takes === 0 ? t('voiceMatch.forget.nothing') : null}
          icon="trash"
          tile="red"
          destructive
          disabled={member.takes === 0}
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
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs },
});
