/**
 * The two rows of Cameras and vision that read more than one field: what the camera is doing right
 * now, with its latest frame, and which kinds of event the pond records.
 */

import React, { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { InkEdge, InkSkeleton } from '@jarida/ink/native';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { CameraFrameView } from '@/components/patterns/camera-frame-view';
import { GIcon } from '@/components/ui/g-icon';
import { Spacing } from '@/constants/spacing';
import { EVENT_TYPES, FACE_EVENT_TYPES, toggleWatchedType, watchedTypes, type EventType } from '@/models/vision';
import type { TranslationKey } from '@/services/i18n';
import { selectionTick } from '@/services/haptics';
import type { PondSettings } from '@/services/types';
import type { UsePondSettings } from '@/view-models/use-pond-settings';
import { useVisionStatus } from '@/view-models/use-vision-status';
import { SwitchRow } from './setting-controls';
import { useSettingsColors, useSettingsMetrics, useSettingsStyles, type SettingsColors, type SettingsMetrics, type SettingsType } from './settings-theme';

/**
 * What the pond's camera is doing, in one sentence, over the frame it is looking at. It is the one
 * thing on its page that wears the edge: the picture is what the page is about, and everything
 * under it is the controls that set it.
 */
export function VisionStatusCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  const m = useSettingsMetrics();
  const { data, loading, error, failed, unsupported, actions } = useVisionStatus(true);
  const state = useContentState({ loading: false, failed, hasContent: !failed });

  // A Pond that cannot say what its camera is doing has nothing to show here.
  if (unsupported) return null;

  if (isUnavailable(state)) {
    return (
      <View style={styles.wrap}>
        <ContentUnavailable compact state={state} reason={error} onRetry={actions.refresh} />
      </View>
    );
  }

  const { status, sentence, frame } = data;
  const camera = status?.camera_id ?? '';

  return (
    <View style={styles.wrap}>
      <InkEdge radius={m.radius.lg} contentStyle={styles.card}>
        <CameraFrameView frame={frame} state={status?.state} sentence={sentence} camera={camera} loading={loading} />

        <View style={styles.words}>
          {sentence ? (
            <>
              <Text style={styles.sentence} accessibilityRole="summary">
                {sentence.sentence}
              </Text>
              {sentence.details.map((line) => (
                <Text key={line} style={styles.detail}>
                  {line}
                </Text>
              ))}
              {sentence.privacy ? (
                <Pressable
                  accessibilityRole="link"
                  hitSlop={8}
                  onPress={() => {
                    void selectionTick();
                    router.push('/(stack)/settings-privacy');
                  }}
                  style={styles.link}
                >
                  <Text style={styles.linkText}>{t('vision.openPrivacy')}</Text>
                  <GIcon name="chevron-right" size={16} color={colors.accent} strokeWidth={2.5} />
                </Pressable>
              ) : null}
            </>
          ) : (
            <InkSkeleton width="70%" height={18} radius="sm" />
          )}
          {error ? <Text style={styles.problem}>{error}</Text> : null}
        </View>
      </InkEdge>
    </View>
  );
}

/** The label and the line under it for each kind, one literal key apiece. */
function typeWords(type: EventType): { label: TranslationKey; hint: TranslationKey } {
  switch (type) {
    case 'motion':
      return { label: 'settings.visionTypes.motion.label', hint: 'settings.visionTypes.motion.hint' };
    case 'person':
      return { label: 'settings.visionTypes.person.label', hint: 'settings.visionTypes.person.hint' };
    case 'pet':
      return { label: 'settings.visionTypes.pet.label', hint: 'settings.visionTypes.pet.hint' };
    case 'vehicle':
      return { label: 'settings.visionTypes.vehicle.label', hint: 'settings.visionTypes.vehicle.hint' };
    case 'package':
      return { label: 'settings.visionTypes.package.label', hint: 'settings.visionTypes.package.hint' };
    case 'face_detected':
      return { label: 'settings.visionTypes.face_detected.label', hint: 'settings.visionTypes.face_detected.hint' };
    case 'face_recognized':
      return { label: 'settings.visionTypes.face_recognized.label', hint: 'settings.visionTypes.face_recognized.hint' };
    case 'face_unknown':
      return { label: 'settings.visionTypes.face_unknown.label', hint: 'settings.visionTypes.face_unknown.hint' };
  }
}

/**
 * One switch per kind of event, as rows of the group they sit in. An empty stored list means every
 * kind to the pond, so the rows read it that way, and the last kind left on cannot be switched off:
 * saving an empty list would switch them all back on.
 */
export function visionEventTypeRows({ settings, vm, t }: { settings: PondSettings; vm: UsePondSettings; t: TFunction }): ReactElement[] {
  const watched = watchedTypes(settings.vision_event_types);
  return EVENT_TYPES.map((type, i) => {
    const on = watched.includes(type);
    const last = on && watched.length === 1;
    const needsFaces = FACE_EVENT_TYPES.includes(type) && !settings.vision_face_recognition_enabled;
    const words = typeWords(type);
    return (
      <SwitchRow
        key={type}
        label={t(words.label)}
        description={t(words.hint)}
        value={on}
        disabled={last}
        note={last ? t('settings.visionTypes.keepOne') : needsFaces ? t('settings.visionTypes.needsRecognition') : null}
        error={i === 0 ? vm.fieldErrors.vision_event_types : null}
        onChange={(next) => {
          const list = toggleWatchedType(settings.vision_event_types, type, next);
          if (list) void vm.actions.update('vision_event_types', list);
        }}
      />
    );
  });
}

const makeStyles = (c: SettingsColors, type: SettingsType, m: SettingsMetrics) => ({
  wrap: { marginBottom: Spacing.xl, gap: Spacing.sm },
  card: { overflow: 'hidden' as const },
  words: { paddingHorizontal: m.rowH, paddingVertical: m.rowV, gap: Spacing.xs },
  sentence: type.label,
  detail: type.description,
  problem: { ...type.note, color: c.danger },
  link: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Spacing.xs,
    minHeight: m.tapMin,
  },
  linkText: { ...type.label, color: c.accent },
});
