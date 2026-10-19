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

import { ScheduleCard } from '@/components/patterns/schedule-card';
import { ScheduleFormSheet } from '@/components/patterns/schedule-form-sheet';
import { deviceTimeZone } from '@/models/schedule';
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
      <View style={styles.header}>
        <InkButton variant="primary" icon="plus" onPress={() => setCreating(true)}>
          {t('schedule.list.newSchedule')}
        </InkButton>
      </View>

      {real && data.live === 'poll' && data.schedules.length > 0 ? (
        <InkText size="sm" tone="tertiary">{t('schedule.list.polling')}</InkText>
      ) : null}

      {loading ? <InkSpinner label={t('schedule.list.loading')} /> : null}

      {/* A failed read can have no sentence of its own (the connection banner
          already says why), but the list is still unknown and worth a retry. */}
      {error || failed ? (
        <View style={styles.notice}>
          <InkNotice tone="danger">{error ?? t('schedule.list.schedulesFailed')}</InkNotice>
          <InkButton variant="quiet" icon="refresh" onPress={actions.refresh}>
            {t('common.retry')}
          </InkButton>
        </View>
      ) : null}

      {/* A list that failed to load is unknown, not empty. */}
      {!loading && !error && !failed && data.schedules.length === 0 ? (
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

      <ScheduleFormSheet open={creating} onClose={() => setCreating(false)} onCreate={actions.create} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.md },
  header: { flexDirection: 'row', justifyContent: 'flex-end' },
  notice: { gap: Spacing.sm },
});
