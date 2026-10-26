/**
 * FaceSheet -- one household member's face, from the pond's side: how many samples it holds, the
 * ways to add one, how strictly a face must match to count as them, and forgetting it.
 *
 * The way to add a sample that works best is at the pond's own camera, because recognition happens
 * there, in that light and from that angle, so it comes first and shows what the camera sees. A
 * photo from this phone is the way for a person who is not home. Nothing here keeps a face on the
 * phone: the pond keeps the data, and the screen says so.
 *
 * The live frame and the capture button wear the edge, the two things here that are for looking
 * at and for doing. Everything else lies flat.
 */

import React, { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkBadge, InkButton, InkEdge, InkNotice, InkSheet } from '@jarida/ink/native';

import { CameraFrameView } from '@/components/patterns/camera-frame-view';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-list';
import { SettingsSlider } from '@/components/settings/settings-slider';
import { useSettingsMetrics, useSettingsStyles, type SettingsColors, type SettingsType } from '@/components/settings/settings-theme';
import { GSheetBody } from '@/components/ui/g-sheet-body';
import { Spacing } from '@/constants/spacing';
import { STRICTNESS_STEP, describeSamples, strictnessRange, toPercent } from '@/models/faces';
import { useConfirm } from '@/providers/confirm-provider';
import { confirm as confirmed, reject, selectionTick } from '@/services/haptics';
import type { FacePerson } from '@/services/types';
import { useFaceEnrolment } from '@/view-models/use-faces';
import { useVisionStatus } from '@/view-models/use-vision-status';

export interface FaceSheetProps {
  /** The person to show; the sheet is open while there is one. */
  person: FacePerson | null;
  /** The pond's own strictness, for the slider's reach and for "use the default". */
  defaultThreshold: number;
  onClose: () => void;
  /** Reads the list again, once the pond holds a sample or has forgotten them. */
  onChanged: () => Promise<void>;
  onForget: (person: FacePerson) => Promise<string | null>;
  /** `null` goes back to the pond's own strictness. Resolves to why the pond refused, or null once saved. */
  onStrictness: (person: FacePerson, threshold: number | null) => Promise<string | null>;
  /** Leaves for Cameras and vision, where a camera that is not running is put right. */
  onOpenCameras: () => void;
}

export function FaceSheet(props: FaceSheetProps) {
  const { person, onClose } = props;
  return (
    <InkSheet open={person !== null} onClose={onClose} title={person?.name ?? ''}>
      {person ? <FaceBody {...props} person={person} /> : null}
    </InkSheet>
  );
}

function FaceBody({
  person,
  defaultThreshold,
  onChanged,
  onForget,
  onStrictness,
  onOpenCameras,
}: Omit<FaceSheetProps, 'person' | 'onClose'> & { person: FacePerson }) {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const m = useSettingsMetrics();
  const ask = useConfirm();
  const vision = useVisionStatus(true);
  const enrolment = useFaceEnrolment(onChanged);
  const { status, sentence, frame } = vision.data;
  const running = status?.state === 'running';
  const busy = enrolment.busy !== null;

  const [moving, setMoving] = useState<number | null>(null);
  const [strictnessError, setStrictnessError] = useState<string | null>(null);
  const [forgetNote, setForgetNote] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const range = strictnessRange(defaultThreshold, person.threshold);
  const shown = moving ?? person.threshold ?? defaultThreshold;

  const saveStrictness = useCallback(
    async (next: number | null) => {
      setMoving(null);
      setStrictnessError(null);
      const refused = await onStrictness(person, next);
      if (refused) {
        void reject();
        setStrictnessError(refused);
      } else {
        void confirmed();
      }
    },
    [onStrictness, person],
  );

  const forget = useCallback(async () => {
    const yes = await ask({
      title: t('faces.forget.title', { name: person.name }),
      message: t('faces.forget.body', { count: person.enrollments, name: person.name }),
      confirmLabel: t('faces.forget.confirm'),
      destructive: true,
    });
    if (!yes) return;
    const refused = await onForget(person);
    if (refused) {
      void reject();
      setForgetNote({ tone: 'danger', text: refused });
    } else {
      void confirmed();
      setForgetNote({ tone: 'success', text: t('faces.forget.done', { name: person.name }) });
    }
  }, [ask, onForget, person, t]);

  const capture = useCallback(async () => {
    setForgetNote(null);
    await enrolment.actions.fromCamera(person, status?.camera_id ?? null);
  }, [enrolment.actions, person, status?.camera_id]);

  const photo = useCallback(
    async (source: 'camera' | 'photos') => {
      setForgetNote(null);
      await enrolment.actions.fromPhoto(person, source);
    },
    [enrolment.actions, person],
  );

  const notice = enrolment.notice;
  const noticeFor = (via: 'camera' | 'photo') =>
    notice && notice.via === via ? (
      <View accessibilityLiveRegion="polite">
        <InkNotice tone={notice.tone}>{notice.text}</InkNotice>
      </View>
    ) : null;

  return (
    <GSheetBody maxHeightRatio={0.9}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.eyebrow} accessibilityRole="header">
              {t('faces.sheet.cameraTitle')}
            </Text>
            <InkBadge tone="neutral">{t('faces.sheet.recommended')}</InkBadge>
          </View>
          <Text style={styles.body}>{t('faces.sheet.cameraBody', { name: person.name })}</Text>

          {running ? (
            <>
              <InkEdge radius={m.radius.lg} contentStyle={styles.frameFace}>
                <CameraFrameView
                  frame={frame}
                  state={status?.state}
                  sentence={sentence}
                  camera={status?.camera_id ?? ''}
                />
              </InkEdge>
              <InkButton
                variant="primary"
                block
                icon="camera"
                disabled={busy || !frame.uri}
                onPress={() => void capture()}
              >
                {enrolment.busy === 'camera' ? t('faces.sheet.capturing') : t('faces.sheet.capture')}
              </InkButton>
              {noticeFor('camera')}
              <Text style={styles.note}>{describeSamples(person.enrollments)}</Text>
            </>
          ) : (
            <View style={styles.down}>
              <Text style={styles.body}>{t('faces.sheet.cameraDown')}</Text>
              {sentence ? <Text style={styles.note}>{sentence.sentence}</Text> : null}
              <InkButton variant="quiet" icon="camera" onPress={onOpenCameras}>
                {t('faces.sheet.openCameras')}
              </InkButton>
              {noticeFor('camera')}
              <Text style={styles.note}>{describeSamples(person.enrollments)}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.eyebrow} accessibilityRole="header">
            {t('faces.sheet.photoTitle')}
          </Text>
          <Text style={styles.body}>{t('faces.sheet.photoBody')}</Text>
          <View style={styles.buttons}>
            <InkButton variant="quiet" icon="photo" disabled={busy} onPress={() => void photo('photos')}>
              {enrolment.busy === 'photo' ? t('faces.sheet.sendingPhoto') : t('faces.sheet.choosePhoto')}
            </InkButton>
            <InkButton variant="quiet" icon="camera" disabled={busy} onPress={() => void photo('camera')}>
              {t('faces.sheet.takePhoto')}
            </InkButton>
          </View>
          {noticeFor('photo')}
        </View>

        <SettingsGroup title={t('faces.strictness.title')}>
          <SettingsRow
            label={t('faces.strictness.readout', { percent: toPercent(shown) })}
            description={t('faces.strictness.body', { name: person.name })}
            note={
              person.threshold === null
                ? t('faces.strictness.default', { percent: toPercent(defaultThreshold) })
                : t('faces.strictness.own', { name: person.name, percent: toPercent(defaultThreshold) })
            }
            error={strictnessError}
          >
            <SettingsSlider
              value={shown}
              min={range.min}
              max={range.max}
              step={STRICTNESS_STEP}
              label={t('faces.strictness.title')}
              valueText={t('faces.strictness.readout', { percent: toPercent(shown) })}
              onChange={setMoving}
              onCommit={(next) => {
                void selectionTick();
                if (Math.abs(next - (person.threshold ?? defaultThreshold)) < STRICTNESS_STEP / 2) {
                  setMoving(null);
                  return;
                }
                void saveStrictness(next);
              }}
            />
            <View style={styles.ends}>
              <Text style={styles.note}>{t('faces.strictness.forgiving')}</Text>
              <Text style={styles.note}>{t('faces.strictness.strict')}</Text>
            </View>
          </SettingsRow>
          {person.threshold !== null ? (
            <SettingsRow label={t('faces.strictness.reset')} action onPress={() => void saveStrictness(null)} />
          ) : null}
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow
            label={t('faces.forget.row')}
            description={person.enrollments === 0 ? t('faces.forget.nothing') : null}
            icon="trash"
            tile="red"
            destructive
            disabled={person.enrollments === 0}
            onPress={() => void forget()}
          />
        </SettingsGroup>
        {forgetNote ? (
          <View accessibilityLiveRegion="polite">
            <InkNotice tone={forgetNote.tone}>{forgetNote.text}</InkNotice>
          </View>
        ) : null}

        <Text style={styles.note}>{t('faces.privacy')}</Text>
      </ScrollView>
    </GSheetBody>
  );
}

const makeStyles = (_c: SettingsColors, type: SettingsType) => ({
  content: { gap: Spacing.lg, paddingBottom: Spacing['2xl'] },
  section: { gap: Spacing.md },
  sectionHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: Spacing.sm },
  eyebrow: { ...type.eyebrow, flexShrink: 1 },
  body: type.body,
  note: type.note,
  frameFace: { overflow: 'hidden' as const },
  down: { gap: Spacing.sm, alignItems: 'flex-start' as const },
  buttons: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: Spacing.sm },
  ends: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
});
