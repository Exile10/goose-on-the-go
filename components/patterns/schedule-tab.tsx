/**
 * ScheduleTab — the timed schedules: list, create, pause and resume, and run
 * now. A card opens the schedule's own screen, which has its run history and
 * the edit and delete.
 */

import React, { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkEmptyState, InkNotice, InkSpinner, InkText } from '@jarida/ink/native';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { useReloadOnPull } from '@/view-models/use-pull-to-refresh';
import { ScheduleCard } from '@/components/patterns/schedule-card';
import { ScheduleFormSheet } from '@/components/patterns/schedule-form-sheet';
import { deviceTimeZone, pondAsksIfMissed } from '@/models/schedule';
import { useServer } from '@/providers/server-provider';
import { selectionTick } from '@/services/haptics';
import type { Schedule } from '@/services/types';
import { useSchedules } from '@/view-models/use-schedules';
import { Spacing } from '@/constants/spacing';

export function ScheduleTab() {
  const { t } = useTranslation();
  const { isScreenReal } = useServer();
  const real = isScreenReal('schedule');
  const { data, loading, error, failed, actions } = useSchedules();
  // The scroll, and so the pull, is the Schedule screen's.
  useReloadOnPull(actions.refresh);
  // A refused refresh with the list still on screen is said above it; a list that never arrived is
  // said once, in its place.
  const state = useContentState({ loading, failed: failed || error !== null, hasContent: data.schedules.length > 0 });
  const unavailable = isUnavailable(state);
  const [creating, setCreating] = useState(false);
  const [phoneZone] = useState(deviceTimeZone);
  const router = useRouter();
  const open = useCallback(
    (schedule: Schedule) => {
      void selectionTick();
      router.push({ pathname: '/(stack)/schedule-detail', params: { id: schedule.id } });
    },
    [router],
  );

  return (
    <View style={styles.body}>
      <InkText size="sm" tone="secondary">{t('schedule.list.intro')}</InkText>
      <View style={styles.header}>
        <InkButton variant="primary" icon="plus" onPress={() => setCreating(true)}>
          {t('schedule.list.newSchedule')}
        </InkButton>
      </View>

      {real && data.live === 'poll' && data.schedules.length > 0 ? (
        <InkText size="sm" tone="tertiary">{t('schedule.list.polling')}</InkText>
      ) : null}

      {loading ? <InkSpinner label={t('schedule.list.loading')} /> : null}

      {unavailable ? (
        <ContentUnavailable state={state} reason={error} onRetry={actions.refresh} />
      ) : error ? (
        <InkNotice tone="danger">{error}</InkNotice>
      ) : null}

      {/* A list that failed to load is unknown, not empty. */}
      {state === 'empty' ? (
        <InkEmptyState icon="schedule" title={t('schedule.list.noSchedulesTitle')}>
          <InkText>{t('schedule.list.noSchedulesBody')}</InkText>
        </InkEmptyState>
      ) : null}

      {data.schedules.map((schedule) => (
        <ScheduleCard
          key={schedule.id}
          schedule={schedule}
          canRun={real}
          phoneZone={phoneZone}
          onOpen={open}
          onSetPaused={actions.setPaused}
          onRunNow={actions.runNow}
        />
      ))}

      <ScheduleFormSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={actions.create}
        asksIfMissed={pondAsksIfMissed(data.schedules)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.md },
  header: { flexDirection: 'row', justifyContent: 'flex-end' },
});
