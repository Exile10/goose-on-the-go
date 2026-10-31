/**
 * ScheduleScreen — what the Pond does on a clock, and what it does when a
 * sensor reports (issue #14).
 *
 * Two tabs rather than one list. The Pond keeps both in its scheduler, but a
 * schedule has a next run and a Run now, and a rule has a trigger and a
 * cooldown instead; shown together, each card would be missing half of what
 * the other says. See `models/schedule.ts` for the rest of that decision.
 *
 * Opened with a `schedule_id` search param, as a schedule notification does,
 * it goes straight on to that schedule's own screen. The list stays beneath
 * it, so Back lands on the schedules rather than leaving the app.
 */

import React, { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkSegmented } from '@jarida/ink/native';

import { AutomationsTab } from '@/components/patterns/automations-tab';
import { ScheduleTab } from '@/components/patterns/schedule-tab';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { linkedScheduleId } from '@/models/schedule';
import { selectionTick } from '@/services/haptics';
import { PullSectionsProvider, usePullSections, usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

type Tab = 'schedules' | 'automations';

export default function ScheduleScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const [tab, setTab] = useState<Tab>('schedules');
  const router = useRouter();
  const { schedule_id } = useLocalSearchParams<{ schedule_id?: string }>();
  const linked = linkedScheduleId(schedule_id);
  // The scroll is this screen's and the list is the tab's: a pull reads whichever tab is shown.
  const { registry, reload } = usePullSections();
  const pull = usePullToRefresh(reload);

  useEffect(() => {
    if (!linked) return;
    // Cleared first, so coming Back to the list does not open the schedule again.
    router.setParams({ schedule_id: undefined });
    router.push({ pathname: '/(stack)/schedule-detail', params: { id: linked } });
  }, [linked, router]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl {...pull} />}
    >
      <InkSegmented
        label={t('schedule.tabs.label')}
        value={tab}
        options={[
          { value: 'schedules', label: t('schedule.tabs.schedules') },
          { value: 'automations', label: t('schedule.tabs.automations') },
        ]}
        onChange={(next) => {
          void selectionTick();
          setTab(next);
        }}
      />
      <PullSectionsProvider value={registry}>
        {tab === 'schedules' ? <ScheduleTab /> : <AutomationsTab />}
      </PullSectionsProvider>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing['4xl'] },
  });
