/**
 * CameraEventsScreen -- what the Pond's camera saw, newest first, with an Acknowledge per event.
 *
 * Reached from Settings > Cameras and smart home, beside the controls that name the camera. The
 * list is for the camera those settings name (`vision_camera_id`), because the Pond lists one
 * camera per read. There is no "acknowledge all" and no delete: the Pond offers neither.
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkEmptyState, InkNotice, InkSpinner, InkText } from '@jarida/ink/native';

import { CameraEventCard } from '@/components/patterns/camera-event-card';
import { useCameraEvents } from '@/view-models/use-camera-events';
import { usePondSettings } from '@/view-models/use-pond-settings';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

export default function CameraEventsScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const settings = usePondSettings();
  const cameraId = settings.settings ? settings.settings.vision_camera_id : null;
  const { data, loading, error, failed, acknowledging, actions } = useCameraEvents(cameraId);

  // Without the settings there is no camera to ask about, so their failure is this screen's.
  if (cameraId === null) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
        {settings.failed ? (
          <View style={styles.notice}>
            <InkNotice tone="danger">{settings.error ?? t('cameraEvents.settingsFailed')}</InkNotice>
            <InkButton variant="quiet" icon="refresh" onPress={settings.actions.refresh}>
              {t('common.retry')}
            </InkButton>
          </View>
        ) : (
          <InkSpinner label={t('cameraEvents.loading')} />
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <InkText tone="secondary">{t('cameraEvents.showing', { camera: cameraId })}</InkText>
          {data.unacknowledged > 0 ? (
            <InkText size="sm" tone="tertiary">
              {t('cameraEvents.unacknowledged', { count: data.unacknowledged })}
            </InkText>
          ) : null}
        </View>
        <InkButton variant="quiet" icon="refresh" disabled={loading} onPress={actions.refresh}>
          {t('common.refresh')}
        </InkButton>
      </View>

      {loading ? <InkSpinner label={t('cameraEvents.loading')} /> : null}

      {/* A failed read with no sentence of its own still leaves the list unknown. */}
      {error || failed ? (
        <View style={styles.notice}>
          <InkNotice tone="danger">{error ?? t('cameraEvents.failed')}</InkNotice>
          <InkButton variant="quiet" icon="refresh" onPress={actions.refresh}>
            {t('common.retry')}
          </InkButton>
        </View>
      ) : null}

      {!loading && !error && !failed && data.events.length === 0 ? (
        <InkEmptyState icon="camera" title={t('cameraEvents.emptyTitle')}>
          <InkText>{t('cameraEvents.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}

      {data.events.map((event) => (
        <CameraEventCard
          key={event.id}
          event={event}
          acknowledging={acknowledging.has(event.id)}
          onAcknowledge={actions.acknowledge}
        />
      ))}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing['4xl'] },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
    headerText: { flex: 1, gap: Spacing.xs },
    notice: { gap: Spacing.sm },
  });
