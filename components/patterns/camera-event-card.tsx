/**
 * CameraEventCard -- one thing a camera saw: what, which camera, when, how sure, and whether
 * somebody has acknowledged it.
 *
 * No picture. The Pond records a snapshot path for some events, but it is a file on the Pond
 * and no route serves it, so there is nothing a phone could load.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkBadge, InkButton, InkCard, InkText } from '@jarida/ink/native';

import { describeConfidence, describeSeen } from '@/models/camera-events';
import { formatScheduleTime } from '@/models/schedule';
import type { CameraEvent } from '@/services/types';
import { Spacing } from '@/constants/spacing';

export interface CameraEventCardProps {
  event: CameraEvent;
  /** An acknowledgement for this event is on its way to the Pond. */
  acknowledging: boolean;
  onAcknowledge: (event: CameraEvent) => void;
}

export const CameraEventCard = React.memo(function CameraEventCard({
  event,
  acknowledging,
  onAcknowledge,
}: CameraEventCardProps) {
  const { t } = useTranslation();
  const confidence = describeConfidence(event);

  return (
    <InkCard>
      <View style={styles.header}>
        <InkText weight="semibold">{describeSeen(event)}</InkText>
        {event.acknowledged ? (
          <InkBadge tone="neutral">{t('cameraEvents.acknowledged')}</InkBadge>
        ) : (
          <InkBadge tone="warning">{t('cameraEvents.new')}</InkBadge>
        )}
      </View>
      <InkText size="sm" tone="secondary">
        {confidence ? t('cameraEvents.detail', { camera: event.camera_id, confidence }) : event.camera_id}
      </InkText>
      <View style={styles.footer}>
        <InkText size="sm" tone="tertiary">{formatScheduleTime(event.created_at)}</InkText>
        {event.acknowledged ? null : (
          <InkButton variant="quiet" icon="check" disabled={acknowledging} onPress={() => onAcknowledge(event)}>
            {t('cameraEvents.acknowledge')}
          </InkButton>
        )}
      </View>
    </InkCard>
  );
});

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
});
