/**
 * CameraFrameView -- the pond camera's latest picture in a fixed box, labelled with what the camera
 * is doing, and a plain stand-in whenever there is no picture to draw.
 *
 * The box is the same size whatever the camera sends and whatever state it is in, so nothing
 * moves when a picture arrives or goes. A picture that stopped arriving says so over its foot
 * rather than sit there looking live.
 */

import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { InkBadge } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { useSettingsColors, useSettingsStyles, type SettingsColors, type SettingsMetrics, type SettingsType } from '@/components/settings/settings-theme';
import type { IconName } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import type { VisionSentence } from '@/models/vision';
import type { VisionState } from '@/services/types';
import type { CameraFrame } from '@/view-models/use-vision-status';

/** Wide enough for a room. */
export const FRAME_RATIO = 16 / 9;

function idleIcon(state: VisionState | undefined): IconName {
  switch (state) {
    case 'off':
      return 'eye-off';
    case 'consent_off':
      return 'lock';
    case 'reconnecting':
      return 'refresh';
    default:
      return 'camera';
  }
}

export interface CameraFrameViewProps {
  frame: CameraFrame;
  state: VisionState | undefined;
  /** The status in words, for the badge; null before it has been read. */
  sentence: VisionSentence | null;
  camera: string;
  /** The first read has not answered, so a stand-in's words would be a guess. */
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function CameraFrameView({ frame, state, sentence, camera, loading, style }: CameraFrameViewProps) {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();

  return (
    <View style={[styles.frame, style]}>
      {frame.uri ? (
        <Image
          source={{ uri: frame.uri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={0}
          accessibilityLabel={t('vision.frame.alt', { camera })}
        />
      ) : sentence === null || loading ? null : (
        <View style={styles.idle}>
          <GIcon name={idleIcon(state)} size={28} color={colors.textTertiary} />
          <Text style={styles.idleText}>{state === 'running' ? t('vision.frame.waiting') : t('vision.frame.idle')}</Text>
        </View>
      )}
      {sentence ? (
        <View style={styles.badge}>
          <InkBadge tone={sentence.tone}>{sentence.label}</InkBadge>
        </View>
      ) : null}
      {frame.uri && frame.stale ? (
        <View style={styles.caption} accessibilityLiveRegion="polite">
          <Text style={styles.captionText}>{t('vision.frame.stale')}</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: SettingsColors, type: SettingsType, m: SettingsMetrics) => ({
  frame: {
    width: '100%' as const,
    aspectRatio: FRAME_RATIO,
    backgroundColor: c.line,
    overflow: 'hidden' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  idle: { alignItems: 'center' as const, gap: Spacing.sm, paddingHorizontal: m.rowH },
  idleText: { ...type.description, textAlign: 'center' as const },
  // The badge's own tint is translucent, so over a picture it needs the page's surface under it.
  badge: {
    position: 'absolute' as const,
    top: Spacing.sm,
    left: Spacing.sm,
    backgroundColor: c.group,
    borderRadius: m.radius.pill,
  },
  // Charcoal at 0.7 over the brightest frame still holds white text at 6.6:1.
  caption: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(23, 22, 22, 0.7)',
    paddingHorizontal: m.rowH,
    paddingVertical: Spacing.sm,
  },
  captionText: { ...type.description, color: '#FFFFFF' },
});
