/**
 * What the conversation shows while Goose interviews the member: how far through the topics they
 * are, in the same eyebrow and meter setup ended on, then the notes Goose drafted, to save with a
 * tap or change by answering, and finally that they were saved.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkDivider, InkEyebrow, InkMeter, InkNotice, InkText, InkTitle } from '@jarida/ink/native';

import { Spacing } from '@/constants/spacing';
import { draftByTopic, interviewProgress, topicNameKey } from '@/models/interview';
import type { ProfileInterview } from '@/services/types';

export function InterviewProgress({ interview }: { interview: ProfileInterview }) {
  const { t } = useTranslation();
  const { settled, total } = interviewProgress(interview.topics);
  if (total === 0) return null;
  return (
    <View style={styles.progress}>
      <InkEyebrow>{t('interview.progress', { settled, total })}</InkEyebrow>
      <InkMeter value={settled / total} label={t('interview.progressLabel')} />
    </View>
  );
}

export function InterviewDraft({
  interview,
  saving,
  error,
  onSave,
}: {
  interview: ProfileInterview;
  saving: boolean;
  error: string | null;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const notes = draftByTopic(interview);
  return (
    // Raised: it is the one thing on screen waiting for the member's answer.
    <InkCard raised contentStyle={styles.card}>
      <InkTitle level={3}>{t('interview.draftTitle')}</InkTitle>
      <InkText tone="secondary">{t('interview.draftLead')}</InkText>
      {/* The words are what the member is agreeing to, so they read at body size and the topic is the label. */}
      <View style={styles.notes}>
        {notes.map((n, i) => {
          const name = topicNameKey(n.topic);
          return (
            <View key={n.key} style={styles.notes}>
              {i > 0 ? <InkDivider /> : null}
              <View style={styles.note}>
                <InkText size="sm" tone="secondary">
                  {name ? t(name) : n.label}
                </InkText>
                <InkText>{n.instruction}</InkText>
              </View>
            </View>
          );
        })}
      </View>
      {error ? <InkNotice tone="danger">{error}</InkNotice> : null}
      <InkButton variant="primary" icon="check" block disabled={saving} onPress={onSave}>
        {t('interview.save')}
      </InkButton>
    </InkCard>
  );
}

export function InterviewSaved({ onSeeNotes }: { onSeeNotes: () => void }) {
  const { t } = useTranslation();
  return (
    <InkCard raised={false} contentStyle={styles.card}>
      <InkTitle level={3}>{t('interview.savedTitle')}</InkTitle>
      <InkText tone="secondary">{t('interview.savedBody')}</InkText>
      <View style={styles.actions}>
        <InkButton variant="quiet" icon="prompts" onPress={onSeeNotes}>
          {t('interview.seeNotes')}
        </InkButton>
      </View>
    </InkCard>
  );
}

const styles = StyleSheet.create({
  progress: { gap: Spacing.xs, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  card: { gap: Spacing.md },
  notes: { gap: Spacing.sm },
  note: { gap: Spacing.xs },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
