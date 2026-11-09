/**
 * Home's card offering the setup interview: Goose asking the member about themselves, one question at
 * a time. Flat, as the setup checklist beside it is, since nothing here is urgent.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkNotice, InkText, InkTitle } from '@/components/ui/ink';

import { Spacing } from '@/constants/spacing';
import { interviewProgress } from '@/models/interview';
import { tap } from '@/services/haptics';
import { useInterviewOffer } from '@/view-models/use-interview-offer';

export function InterviewOffer() {
  const { t } = useTranslation();
  const { invite, interview, busy, error, actions } = useInterviewOffer();
  if (!invite || !interview) return null;
  const { settled, total } = interviewProgress(interview.topics);

  const open = () => {
    void tap();
    void actions.open();
  };

  return (
    <InkCard raised={false} contentStyle={styles.card}>
      <InkTitle level={3}>
        {invite === 'start' ? t('interview.offer.startTitle') : invite === 'resume' ? t('interview.offer.resumeTitle') : t('interview.offer.reviewTitle')}
      </InkTitle>
      <InkText tone="secondary">
        {invite === 'start'
          ? t('interview.offer.startBody')
          : invite === 'resume'
            ? t('interview.offer.resumeBody', { settled, total })
            : t('interview.offer.reviewBody')}
      </InkText>
      {error ? <InkNotice tone="danger">{t('interview.startFailed')}</InkNotice> : null}
      <View style={styles.actions}>
        <InkButton variant="quiet" onPress={actions.dismiss}>
          {t('interview.offer.dismiss')}
        </InkButton>
        <InkButton variant="primary" icon="chat" disabled={busy} onPress={open}>
          {invite === 'start' ? t('interview.offer.start') : invite === 'resume' ? t('interview.offer.resume') : t('interview.offer.review')}
        </InkButton>
      </View>
    </InkCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.md },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
});
