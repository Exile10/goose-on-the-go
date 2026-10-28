/**
 * VisionEventsScreen -- what the Pond's camera saw, newest first: its picture, who or what it was,
 * how sure the pond was, filtered to the kind of thing wanted, and arriving as it happens.
 *
 * Reached from Settings > Cameras and vision. The list is for the camera those settings name
 * (`vision_camera_id`), because the Pond lists one camera per read. A row opens the event in a
 * sheet, where it can be acknowledged or made into an automation. There is no "acknowledge all"
 * and no delete: the Pond offers neither.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkChip, InkEmptyState, InkNotice, InkSpinner, InkText, useInkTheme } from '@jarida/ink/native';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { VisionEventRow } from '@/components/patterns/vision-event-row';
import { VisionEventSheet } from '@/components/patterns/vision-event-sheet';
import { isUnavailable } from '@/models/content-state';
import { EVENT_FILTERS, filterLabel } from '@/models/vision';
import { selectionTick } from '@/services/haptics';
import type { CameraEvent } from '@/services/types';
import { useContentState } from '@/view-models/use-content-state';
import { useCreateRule } from '@/view-models/use-rules';
import { useFaces } from '@/view-models/use-faces';
import { usePondSettings } from '@/view-models/use-pond-settings';
import { useVisionEvents } from '@/view-models/use-vision-events';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

const keyOf = (event: CameraEvent) => String(event.id);

function Separator() {
  const theme = useInkTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.color.line }} />;
}

export default function VisionEventsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const settings = usePondSettings();
  const cameraId = settings.settings ? settings.settings.vision_camera_id : null;
  const { data, live, streamBlocked, loading, error, failed, acknowledging, actions } = useVisionEvents(cameraId);
  const { nameOf } = useFaces();
  const createRule = useCreateRule();
  const [openId, setOpenId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Without the settings there is no camera to ask about, so their failure is this screen's.
  const settingsState = useContentState({ loading: !settings.failed, failed: settings.failed, hasContent: false });
  const state = useContentState({ loading, failed: failed || error !== null, hasContent: data.events.length > 0 });
  const unavailable = isUnavailable(state);

  const open = useMemo(() => data.events.find((e) => e.id === openId) ?? null, [data.events, openId]);
  const onOpen = useCallback((event: CameraEvent) => setOpenId(event.id), []);
  const closeSheet = useCallback(() => setOpenId(null), []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await actions.refresh();
    setRefreshing(false);
  }, [actions]);

  if (cameraId === null) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
        {isUnavailable(settingsState) ? (
          <ContentUnavailable state={settingsState} reason={settings.error} onRetry={settings.actions.refresh} />
        ) : (
          <InkSpinner label={t('visionEvents.loading')} />
        )}
      </ScrollView>
    );
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <InkText tone="secondary">{t('visionEvents.showing', { camera: cameraId })}</InkText>
        <InkText size="sm" tone="tertiary">
          {live ? t('visionEvents.live') : t('visionEvents.polling')}
        </InkText>
        {data.unacknowledged > 0 ? (
          <InkText size="sm" tone="tertiary">
            {t('visionEvents.unacknowledged', { count: data.unacknowledged })}
          </InkText>
        ) : null}
      </View>

      {streamBlocked ? (
        <View style={styles.notice}>
          <InkNotice tone="warning">{t('visionEvents.privacyOff')}</InkNotice>
          <InkButton variant="quiet" icon="shield" onPress={() => router.push('/(stack)/settings-privacy')}>
            {t('vision.openPrivacy')}
          </InkButton>
        </View>
      ) : null}

      {/* Filters are chrome, so they stay on a hairline: the chosen one is tinted, not raised. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('visionEvents.filter.label')}
      >
        {EVENT_FILTERS.map((filter) => (
          <InkChip
            key={filter}
            selected={data.filter === filter}
            onPress={() => {
              void selectionTick();
              actions.setFilter(filter);
            }}
          >
            {filterLabel(filter)}
          </InkChip>
        ))}
      </ScrollView>

      {/* A refused refresh above the list it left in place; a list that never arrived is said once,
          in its place below. */}
      {!unavailable && error ? <InkNotice tone="danger">{error}</InkNotice> : null}
    </View>
  );

  const empty = loading ? (
    <InkSpinner label={t('visionEvents.loading')} />
  ) : unavailable ? (
    <ContentUnavailable state={state} reason={error} onRetry={actions.refresh} />
  ) : data.events.length === 0 ? (
    <InkEmptyState icon="camera" title={t('visionEvents.emptyTitle')}>
      <InkText>{t('visionEvents.emptyBody')}</InkText>
    </InkEmptyState>
  ) : (
    <InkEmptyState
      icon="filter"
      title={t('visionEvents.noMatchTitle')}
      action={
        <InkButton variant="quiet" onPress={() => actions.setFilter('all')}>
          {t('visionEvents.showAll')}
        </InkButton>
      }
    >
      <InkText>{t('visionEvents.noMatchBody', { count: data.events.length })}</InkText>
    </InkEmptyState>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={data.shown}
        keyExtractor={keyOf}
        renderItem={({ item }) => <VisionEventRow event={item} nameOf={nameOf} onOpen={onOpen} />}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        windowSize={7}
        initialNumToRender={8}
        // A name arriving redraws the rows that were waiting for it.
        extraData={nameOf}
      />

      <VisionEventSheet
        event={open}
        nameOf={nameOf}
        acknowledging={open ? acknowledging.has(open.id) : false}
        onClose={closeSheet}
        onAcknowledge={actions.acknowledge}
        onCreateRule={createRule}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing['4xl'] },
    header: { gap: Spacing.md, paddingBottom: Spacing.md },
    headerText: { gap: Spacing.xs },
    chips: { gap: Spacing.sm },
    notice: { gap: Spacing.sm },
  });
