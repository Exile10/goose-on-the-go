/**
 * ScheduleDetailScreen — one schedule as the Pond has it, opened from its
 * card or from a notification about it.
 *
 * Shows what it runs, when (in words and as the cron the Pond keeps), its
 * zone, whether it is on, its next and last run, and its recent runs with what
 * each said or why it failed. Edit, pause and resume, run now and delete are
 * here; each change is the Pond's answer, not a guess, and a refusal says why.
 *
 * Delete is kept apart from the rest, at the foot of the screen below the
 * runs: it is the one action that cannot be taken back, and sitting in the
 * same wrapped row as Edit it read as a stray.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  InkBadge,
  InkButton,
  InkCard,
  InkNotice,
  InkSpinner,
  InkText,
} from '@jarida/ink/native';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { LabelledSwitch } from '@/components/patterns/labelled-switch';
import { RunRow } from '@/components/patterns/schedule-run-row';
import { ScheduleFormSheet } from '@/components/patterns/schedule-form-sheet';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import {
  describeRoutine,
  deviceTimeZone,
  describeWhen,
  formatScheduleTime,
  isOneOff,
  linkedScheduleId,
  promptOf,
  routineDevices,
} from '@/models/schedule';
import { useConfirm } from '@/providers/confirm-provider';
import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import { toggle } from '@/services/haptics';
import { useScheduleDetail } from '@/view-models/use-schedule-detail';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

/** One labelled line of the schedule's facts. */
function Fact({ label, children, mono }: { label: string; children: string; mono?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.fact}>
      <InkText size="sm" tone="tertiary">{label}</InkText>
      <InkText mono={mono}>{children}</InkText>
    </View>
  );
}

/**
 * What a routine sets, by device name. The names are read once: a rename while this is open is not
 * worth a poll, and if the read fails the device ids still say which devices they are.
 */
function RoutineFact({ devices }: { devices: Record<string, boolean> }) {
  const { t } = useTranslation();
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let current = true;
    api
      .listDevices()
      .then((list) => {
        if (current) setNames(Object.fromEntries(list.map((d) => [d.id, d.name])));
      })
      .catch((e: unknown) => console.warn('[schedule-detail] device names unavailable', e));
    return () => {
      current = false;
    };
  }, []);
  return <Fact label={t('schedule.detail.routine')}>{describeRoutine(devices, names)}</Fact>;
}

export default function ScheduleDetailScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { isScreenReal } = useServer();
  const real = isScreenReal('schedule');
  const params = useLocalSearchParams<{ id?: string }>();
  const id = linkedScheduleId(params.id) ?? '';
  const { schedule, loading, missing, error, failed, notice, runs, actions } = useScheduleDetail(id);
  const state = useContentState({ loading, failed: failed || error !== null, hasContent: schedule !== null });
  const runsState = useContentState({
    loading: runs.loading,
    failed: runs.failed || runs.error !== null,
    hasContent: runs.data.runs.length > 0,
  });
  // A pull reads both halves of the page: the schedule and its recent runs.
  const reloadAll = useCallback(() => {
    actions.refreshRuns();
    return actions.refresh();
  }, [actions]);
  const pull = usePullToRefresh(reloadAll);
  const [editing, setEditing] = useState(false);
  const [phoneZone] = useState(deviceTimeZone);
  const ask = useConfirm();

  const confirmDelete = async () => {
    if (!schedule) return;
    const yes = await ask({
      title: t('schedule.detail.deleteTitle'),
      message: t('schedule.detail.deleteBody', { name: schedule.label }),
      confirmLabel: t('schedule.detail.delete'),
      destructive: true,
    });
    if (yes && (await actions.remove())) router.back();
  };

  if (!schedule) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll} refreshControl={<RefreshControl {...pull} />}>
        {loading ? <InkSpinner label={t('schedule.detail.loading')} /> : null}
        {isUnavailable(state) ? (
          <ContentUnavailable state={state} reason={error} onRetry={actions.refresh} />
        ) : null}
        {state === 'empty' && (missing || !id) ? (
          <InkNotice tone="warning">{t('schedule.errors.gone')}</InkNotice>
        ) : null}
      </ScrollView>
    );
  }

  const when = describeWhen(schedule, phoneZone);
  const prompt = promptOf(schedule);
  const devices = routineDevices(schedule);
  const oneOff = isOneOff(schedule);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll} refreshControl={<RefreshControl {...pull} />}>
      <View style={styles.gap}>
        <InkText size="xl" weight="semibold">{schedule.label}</InkText>
        {schedule.currently_running ? <InkBadge tone="brand">{t('schedule.card.running')}</InkBadge> : null}
      </View>

      {notice === 'saved' ? <InkNotice tone="success">{t('schedule.detail.saved')}</InkNotice> : null}
      {notice === 'runStarted' ? <InkNotice tone="success">{t('schedule.detail.runStarted')}</InkNotice> : null}
      {notice === 'missedSkipped' ? <InkNotice tone="success">{t('schedule.detail.missedSkipped')}</InkNotice> : null}
      {error ? <InkNotice tone="danger">{error}</InkNotice> : null}

      {schedule.missed_run ? (
        <InkCard>
          <View style={styles.gap}>
            <InkText weight="semibold">
              {t('schedule.missed.question', { when: formatScheduleTime(schedule.missed_run.due_at) })}
            </InkText>
            <View style={styles.buttons}>
              <InkButton
                variant="primary"
                icon="play"
                block
                style={styles.button}
                onPress={() => void actions.answerMissed('run')}
              >
                {t('schedule.missed.run')}
              </InkButton>
              <InkButton variant="quiet" block style={styles.button} onPress={() => void actions.answerMissed('skip')}>
                {t('schedule.missed.skip')}
              </InkButton>
            </View>
          </View>
        </InkCard>
      ) : null}

      <InkCard>
        <View style={styles.gap}>
          {devices ? (
            <RoutineFact devices={devices} />
          ) : prompt != null ? (
            <Fact label={t('schedule.detail.prompt')}>{prompt}</Fact>
          ) : (
            <Fact label={t('schedule.detail.webhook')}>{t('schedule.detail.webhookNote')}</Fact>
          )}
          <Fact label={t('schedule.detail.when')} mono={!when.words}>{when.text}</Fact>
          {oneOff ? null : (
            <Fact label={t('schedule.detail.cron')} mono>
              {schedule.cron}
            </Fact>
          )}
          <Fact label={t('schedule.detail.timezone')}>{schedule.timezone}</Fact>
          <Fact label={t('schedule.detail.nextRun')}>
            {schedule.next_run ? formatScheduleTime(schedule.next_run) : t('schedule.detail.notScheduled')}
          </Fact>
          <Fact label={t('schedule.detail.lastRun')}>
            {schedule.last_run ? formatScheduleTime(schedule.last_run) : t('schedule.detail.never')}
          </Fact>
        </View>
      </InkCard>

      <InkCard>
        <View style={styles.gap}>
          {oneOff ? (
            <InkText size="sm" tone="tertiary">{t('schedule.detail.oneOffNoPause')}</InkText>
          ) : (
            <LabelledSwitch
              label={schedule.paused ? t('schedule.detail.paused') : t('schedule.detail.enabled')}
              checked={!schedule.paused}
              onChange={(on) => {
                void toggle();
                void actions.setPaused(!on);
              }}
            />
          )}
          <View style={styles.buttons}>
            <InkButton variant="quiet" icon="edit" block style={styles.button} onPress={() => setEditing(true)}>
              {t('schedule.detail.edit')}
            </InkButton>
            {real ? (
              <InkButton
                variant="quiet"
                icon="play"
                block
                style={styles.button}
                disabled={schedule.currently_running || schedule.paused}
                onPress={actions.runNow}
              >
                {t('schedule.card.runNow')}
              </InkButton>
            ) : null}
          </View>
        </View>
      </InkCard>

      <View style={styles.gap}>
        <InkText weight="semibold">{t('schedule.runs.title')}</InkText>
        {runs.loading ? <InkSpinner label={t('schedule.runs.title')} /> : null}
        {isUnavailable(runsState) ? (
          <ContentUnavailable compact state={runsState} reason={runs.error} onRetry={actions.refreshRuns} />
        ) : null}
        {runsState === 'empty' ? (
          <InkText tone="secondary">{t('schedule.runs.none')}</InkText>
        ) : null}
        {runs.data.runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </View>

      <View style={styles.dangerZone}>
        <InkButton variant="danger" icon="trash" block onPress={() => void confirmDelete()}>
          {t('schedule.detail.delete')}
        </InkButton>
      </View>

      <ScheduleFormSheet
        open={editing}
        onClose={() => setEditing(false)}
        schedule={schedule}
        onUpdate={actions.update}
      />
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing['4xl'] },
    gap: { gap: Spacing.sm },
    fact: { gap: Spacing.xs },
    buttons: { flexDirection: 'row', gap: Spacing.sm },
    // Edit and Run now split the row evenly; Edit alone fills it.
    button: { flex: 1 },
    dangerZone: {
      marginTop: Spacing.lg,
      paddingTop: Spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
  });
