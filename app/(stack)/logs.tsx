/**
 * ActivityScreen — what Goose has been doing, newest first, from the Pond's
 * activity log (issue #15).
 *
 * Filters are named for what a reader is looking for rather than for the enum
 * behind them: `mcp` reads as "Tools", because a household is looking for the
 * thing Goose reached out to, not for the protocol it used to do it. Which
 * category falls under which filter is `filterOf` in models/log.ts.
 *
 * The type badge appears only in the unfiltered view. Once every row is an
 * action, a badge on each one reading "Actions" is the filter repeated.
 *
 * Problems is the odd one out: it lists the Pond's own warnings and errors
 * from its operational log, a different store from the activity above. The
 * export lives there too, since the file it shares is that same log.
 *
 * Above the activity list, a strip counts the last day by filter. It is left
 * off Problems, which is not activity, and off a day with nothing in it,
 * where the list's own empty state already says so.
 *
 * Below it, a card shows how Goose's latest conversation went, from the Pond's
 * telemetry; tapping it lists that conversation's turns.
 *
 * Clearing sits just under the filters, outside the list so it does not scroll
 * away, behind a confirmation: it deletes the Pond's activity history for
 * everyone in the household. With nothing listed there is nothing to clear,
 * so it is disabled rather than offering a deletion that does nothing.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTranslation } from 'react-i18next';
import {
  InkButton,
  InkChoice,
  InkDialog,
  InkEmptyState,
  InkNotice,
  InkSpinner,
  InkText,
} from '@/components/ui/ink';

import { GIcon } from '@/components/ui/g-icon';
import { TelemetryCard, TurnsSheet } from '@/components/patterns/conversation-telemetry';
import { caution, confirm, selectionTick } from '@/services/haptics';
import type { ActivityEvent, ActivitySummary, LogEntry } from '@/services/types';
import {
  ACTIVITY_FILTERS,
  categoryIcon,
  countsByFilter,
  describeEvent,
  eventFilter,
  eventKeys,
  filterLabelKey,
  parsePondLogTime,
  type ActivityFilter,
} from '@/models/log';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { describeActivityError, useActivity } from '@/view-models/use-activity';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { useActivitySummary } from '@/view-models/use-activity-summary';
import { useConversationTelemetry, useConversationTurns } from '@/view-models/use-conversation-telemetry';
import { useLogExport } from '@/view-models/use-log-export';
import { useSnackbar } from '@/providers/snackbar-provider';
import { useProblems } from '@/view-models/use-problems';
import { formatRelativeTime } from '@/view-models/use-recent-sessions';
import { Grey } from '@/constants/colors';
import { FontSize, face } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useTheme } from '@/providers/theme-provider';
import type { ThemeColors } from '@/constants/colors';

const EventRow = React.memo(function EventRow({
  item,
  showType,
}: {
  item: ActivityEvent;
  showType: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { title, detail } = describeEvent(item, t);
  // Presence and session events fall under no filter, so they carry no badge.
  const filter = eventFilter(item);
  return (
    <View style={styles.logRow}>
      <View style={styles.logIcon}>
        <GIcon name={categoryIcon(item.category)} size={16} color={Grey[600]} />
      </View>
      <View style={styles.logBody}>
        <Text style={styles.logText}>{title}</Text>
        {detail ? <Text style={styles.logDetail}>{detail}</Text> : null}
        <View style={styles.logMeta}>
          <Text style={styles.logTime}>{formatRelativeTime(item.timestamp)}</Text>
          {showType && filter ? (
            <View style={styles.typeBadge}>
              <Text style={styles.typeText}>{t(filterLabelKey(filter))}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
});

/** A warning or error from the Pond's own log: what it said, where, and when. */
const ProblemRow = React.memo(function ProblemRow({ item }: { item: LogEntry }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const color = item.level.toUpperCase() === 'ERROR' ? colors.danger : colors.warning;
  return (
    <View style={styles.logRow}>
      <View style={styles.logIcon}>
        <GIcon name="warn" size={16} color={color} />
      </View>
      <View style={styles.logBody}>
        <Text style={styles.logText}>{item.message}</Text>
        <Text style={styles.logDetail}>{item.source}</Text>
        <View style={styles.logMeta}>
          <Text style={styles.logTime}>{formatRelativeTime(parsePondLogTime(item.timestamp))}</Text>
        </View>
      </View>
    </View>
  );
});

/** The last day in one line: the total, then each filter's share, largest first. */
function TodayStrip({ summary }: { summary: ActivitySummary }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const counts = countsByFilter(summary);
  return (
    <View style={styles.today} accessibilityRole="summary">
      <Text style={styles.todayTotal}>{t('activity.today', { count: summary.total })}</Text>
      <View style={styles.todayCounts}>
        {counts.map(({ filter, count }) => (
          <Text key={filter} style={styles.todayCount}>
            {t('activity.todayCount', { label: t(filterLabelKey(filter)), count })}
          </Text>
        ))}
      </View>
    </View>
  );
}

const problemKey = (item: LogEntry) => String(item.id);
const renderProblem = ({ item }: { item: LogEntry }) => <ProblemRow item={item} />;

export default function ActivityScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ActivityFilter>('all');
  const showingProblems = activeTab === 'error';
  // Problems spans no activity category, so on that filter this asks the Pond nothing.
  const activity = useActivity(activeTab);
  const activitySummary = useActivitySummary();
  const { summary } = activitySummary.data;
  const { latest } = useConversationTelemetry().data;
  const turns = useConversationTurns();
  const logExport = useLogExport();

  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const snackbar = useSnackbar();
  // What the snackbar's Try again calls: the current `clearActivity`, set below once it is made.
  const retryClear = useRef<() => Promise<void>>(async () => {});
  const askClear = useCallback(() => {
    void caution();
    setConfirmingClear(true);
  }, []);
  const clearActivity = useCallback(async () => {
    setConfirmingClear(false);
    setClearing(true);
    try {
      const purged = await activity.actions.clear();
      void confirm();
      snackbar.show({ message: t('activity.clear.done', { count: purged }), tone: 'success' });
      void activitySummary.actions.refresh();
    } catch (e) {
      console.warn('[activity] clear failed', e instanceof Error ? e.name : 'unknown');
      // Somebody asked for this: a failure is said even when the banner explains why. Try again
      // clears what they already agreed to clear; it does not ask a second time.
      snackbar.show({
        message: describeActivityError(e) ?? t('activity.clear.failed'),
        tone: 'danger',
        action: { label: t('common.retry'), onPress: () => void retryClear.current() },
      });
    } finally {
      setClearing(false);
    }
  }, [activity.actions, activitySummary.actions, snackbar, t]);
  useEffect(() => {
    retryClear.current = clearActivity;
  }, [clearActivity]);
  const [turnsOpen, setTurnsOpen] = useState(false);
  const openTurns = useCallback(() => {
    if (!latest) return;
    setTurnsOpen(true);
    void turns.actions.load(latest.session.id);
  }, [latest, turns.actions]);
  const problems = useProblems(showingProblems);
  const { loading, error, actions } = showingProblems ? problems : activity;
  const failed = showingProblems ? problems.failed : activity.failed;
  const data = activity.data;
  const shownCount = showingProblems ? problems.data.problems.length : data.events.length;
  const state = useContentState({ loading, failed: failed || error !== null, hasContent: shownCount > 0 });
  const unavailable = isUnavailable(state);
  // The feed's pull also reads today's summary above it; the problems tab is its one list.
  const reloadShown = useCallback(
    () => (showingProblems ? actions.refresh() : Promise.all([actions.refresh(), activitySummary.actions.refresh()])),
    [actions, activitySummary.actions, showingProblems],
  );
  const pull = usePullToRefresh(reloadShown);

  const renderItem = useCallback(
    ({ item }: { item: ActivityEvent }) => <EventRow item={item} showType={activeTab === 'all'} />,
    [activeTab],
  );

  // Keyed once per read. The index only finds an event's key; the key itself
  // holds no position, so a row keeps it when a poll adds newer ones above.
  const keys = useMemo(() => eventKeys(data.events), [data.events]);
  const keyExtractor = useCallback((_item: ActivityEvent, index: number) => keys[index], [keys]);

  const header = (
    <>
      {showingProblems ? (
        <View style={styles.notice}>
          <InkButton
            variant="quiet"
            icon="download"
            disabled={logExport.exporting}
            onPress={logExport.actions.exportLogs}
          >
            {logExport.exporting ? t('activity.export.exporting') : t('activity.export.button')}
          </InkButton>
        </View>
      ) : null}
      {!showingProblems && summary && summary.total > 0 ? <TodayStrip summary={summary} /> : null}
      {!showingProblems && latest ? <TelemetryCard latest={latest} onOpen={openTurns} /> : null}
      {loading ? <InkSpinner label={t('activity.loading')} /> : null}
      {/* A refused refresh above the list it left in place. A list that never arrived is said
          once, in the list's own place below. */}
      {!unavailable && error ? <InkNotice tone="danger">{error}</InkNotice> : null}
    </>
  );

  return (
    <View style={styles.container}>
      {/* Filter tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabsRow}
      >
        {ACTIVITY_FILTERS.map((tab) => (
          <InkChoice
            key={tab}
            role="radio"
            shape="pill"
            selected={activeTab === tab}
            onSelect={() => {
              void selectionTick();
              setActiveTab(tab);
            }}
          >
            {t(filterLabelKey(tab))}
          </InkChoice>
        ))}
      </ScrollView>

      {showingProblems ? null : (
        <View style={styles.clearBar}>
          <InkButton
            variant="quiet"
            icon="trash"
            disabled={clearing || loading || data.events.length === 0}
            onPress={askClear}
          >
            {clearing ? t('activity.clear.clearing') : t('activity.clear.button')}
          </InkButton>
        </View>
      )}

      {showingProblems ? (
        <FlatList
          data={problems.data.problems}
          keyExtractor={problemKey}
          renderItem={renderProblem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl {...pull} />}
          ListHeaderComponent={header}
          ListEmptyComponent={
            unavailable ? (
              <ContentUnavailable state={state} reason={error} onRetry={actions.refresh} />
            ) : state === 'empty' ? (
              <InkEmptyState icon="check" title={t('activity.noProblems')}>
                <InkText>{t('activity.noProblemsBody')}</InkText>
              </InkEmptyState>
            ) : null
          }
        />
      ) : (
        <FlatList
          data={data.events}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          // A poll puts newer events above; this keeps the row being read where it is.
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl {...pull} />}
          ListHeaderComponent={header}
          // A list that failed to load is unknown, not empty.
          ListEmptyComponent={
            unavailable ? (
              <ContentUnavailable state={state} reason={error} onRetry={actions.refresh} />
            ) : state === 'empty' ? (
              <InkEmptyState icon="logs" title={t('activity.empty')}>
                <InkText>{t('activity.emptyBody')}</InkText>
              </InkEmptyState>
            ) : null
          }
        />
      )}

      <InkDialog
        open={confirmingClear}
        onClose={() => setConfirmingClear(false)}
        title={t('activity.clear.title')}
        description={t('activity.clear.body')}
        actions={
          <>
            <InkButton variant="quiet" onPress={() => setConfirmingClear(false)}>
              {t('common.cancel')}
            </InkButton>
            <InkButton variant="danger" onPress={clearActivity}>
              {t('activity.clear.confirm')}
            </InkButton>
          </>
        }
      />

      <TurnsSheet
        open={turnsOpen}
        title={latest?.session.title || t('activity.telemetry.untitled')}
        turns={turns}
        onClose={() => setTurnsOpen(false)}
        onRetry={openTurns}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  /* Tabs */
  // Pins this ScrollView's own height to its content instead of letting it
  // compete for leftover flex space with the list below — without this,
  // filtering to a category with fewer results frees up vertical space
  // that gets redistributed into the tab pills instead of staying blank,
  // stretching them tall.
  tabsScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  tabsRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: c.card,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },

  /* List */
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingBottom: Spacing['3xl'],
  },

  /* Log row */
  logRow: {
    flexDirection: 'row',
    backgroundColor: c.card,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: Spacing.sm,
  },
  logIcon: { marginRight: Spacing.md, marginTop: 2 },
  logBody: { flex: 1 },
  logText: {
    ...face('body', 'regular'),
    fontSize: FontSize.base,
    lineHeight: FontSize.base * 1.5,
    color: c.text,
  },
  logDetail: {
    ...face('body', 'regular'),
    fontSize: FontSize.sm,
    color: c.textSecondary,
    marginTop: 2,
  },
  logMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  logTime: {
    ...face('mono', 'regular'),
    fontSize: FontSize.xs,
    color: Grey[400],
  },
  typeBadge: {
    backgroundColor: c.backgroundTertiary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radii.pill,
  },
  typeText: {
    ...face('body', 'bold'),
    fontSize: 10,
    color: c.textSecondary,
  },
  notice: { gap: Spacing.sm, marginBottom: Spacing.md },
  clearBar: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    alignItems: 'flex-end',
  },

  /* Today */
  today: {
    backgroundColor: c.card,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: Spacing.md,
    gap: Spacing.xs,
  },
  todayTotal: {
    ...face('body', 'semibold'),
    fontSize: FontSize.base,
    color: c.text,
  },
  todayCounts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.md },
  todayCount: {
    ...face('body', 'regular'),
    fontSize: FontSize.sm,
    color: c.textSecondary,
  },
});
