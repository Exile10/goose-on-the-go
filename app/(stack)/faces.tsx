/**
 * FacesScreen -- who the pond knows by sight, and how to teach it.
 *
 * Every household member is here, whether or not the pond has a sample of their face. A person
 * opens a sheet to add samples at the pond's camera or from a photo, set how strictly a face has to
 * match, or have the pond forget it. Face data stays on the pond, and the screen says so before
 * anything else: it is the thing a household most wants to know before it enrols a face.
 *
 * A pond with no face model shows why, and what to do instead, in place of controls that could do
 * nothing.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkEmptyState, InkNotice, InkSpinner, InkText } from '@jarida/ink/native';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { FaceSheet } from '@/components/patterns/face-sheet';
import { SettingsGroup, SettingsHeader, SettingsRow } from '@/components/settings/settings-list';
import { SettingsScroll } from '@/components/settings/settings-scroll';
import { useSettingsColors, useSettingsStyles, type SettingsType } from '@/components/settings/settings-theme';
import { GIcon } from '@/components/ui/g-icon';
import { sampleCount } from '@/models/faces';
import { selectionTick } from '@/services/haptics';
import { useFaces } from '@/view-models/use-faces';
import { usePondSettings } from '@/view-models/use-pond-settings';
import { Spacing } from '@/constants/spacing';

export default function FacesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  const { data, loading, error, failed, actions } = useFaces();
  const state = useContentState({ loading, failed, hasContent: data.people.length > 0 });
  const settings = usePondSettings();
  const [openId, setOpenId] = useState<string | null>(null);

  const open = useMemo(() => data.people.find((p) => p.profile_id === openId) ?? null, [data.people, openId]);
  const recognitionOff = settings.settings !== null && !settings.settings.vision_face_recognition_enabled;

  // Left for Cameras and vision from inside the sheet: the sheet is closed first, since a page
  // pushed under an open modal is not seen until it is dismissed.
  const openCameras = useCallback(() => {
    setOpenId(null);
    router.push('/(stack)/settings-cameras');
  }, [router]);

  const quietRefresh = useCallback(() => actions.refresh(), [actions]);
  const pull = usePullToRefresh(quietRefresh);

  return (
    <SettingsScroll refreshControl={<RefreshControl {...pull} />}>
      <SettingsHeader icon="face" tile="indigo" title={t('screens.faces')} description={t('faces.intro')} />

      <View style={styles.privacy}>
        <GIcon name="lock" size={16} color={colors.textTertiary} />
        <Text style={styles.privacyText}>{t('faces.privacy')}</Text>
      </View>

      {recognitionOff ? (
        <View style={styles.notice}>
          <InkNotice tone="warning">{t('faces.recognitionOff')}</InkNotice>
          <InkButton
            variant="quiet"
            icon="power"
            onPress={() => void settings.actions.update('vision_face_recognition_enabled', true)}
          >
            {t('faces.switchOn')}
          </InkButton>
        </View>
      ) : null}

      {loading && data.people.length === 0 ? <InkSpinner label={t('faces.loading')} /> : null}

      {isUnavailable(state) ? <ContentUnavailable state={state} reason={error} onRetry={quietRefresh} /> : null}

      {!loading && !failed && !data.available ? (
        <InkEmptyState icon="face" title={t('faces.unavailableTitle')}>
          <InkText>{t('faces.unavailableBody')}</InkText>
        </InkEmptyState>
      ) : null}

      {!loading && !failed && data.available && data.people.length === 0 ? (
        <InkEmptyState
          icon="users"
          title={t('faces.emptyTitle')}
          action={
            <InkButton variant="quiet" icon="plus" onPress={() => router.push('/(stack)/add-users')}>
              {t('faces.addPerson')}
            </InkButton>
          }
        >
          <InkText>{t('faces.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}

      {data.available && data.people.length > 0 ? (
        <SettingsGroup>
          {data.people.map((person) => (
            <SettingsRow
              key={person.profile_id}
              label={person.name}
              // The shape of the glyph says who the pond knows; a colour would say more than is true.
              icon={person.enrollments > 0 ? 'face' : 'profile'}
              tile="slate"
              description={person.enrollments > 0 ? t('faces.person.known') : t('faces.person.notKnown')}
              value={sampleCount(person.enrollments)}
              accessory="next"
              onPress={() => {
                void selectionTick();
                setOpenId(person.profile_id);
              }}
            />
          ))}
        </SettingsGroup>
      ) : null}

      <FaceSheet
        person={data.available ? open : null}
        defaultThreshold={data.defaultThreshold}
        onClose={() => setOpenId(null)}
        onChanged={quietRefresh}
        onForget={actions.forget}
        onStrictness={actions.setStrictness}
        onOpenCameras={openCameras}
      />
    </SettingsScroll>
  );
}

const makeStyles = (_c: unknown, type: SettingsType) => ({
  privacy: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.sm, marginBottom: Spacing.xl },
  privacyText: { ...type.prose, flex: 1 },
  notice: { gap: Spacing.sm, marginBottom: Spacing.xl },
});
