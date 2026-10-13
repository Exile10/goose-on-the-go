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
 * from its operational log, a different store from the activity above.
 *
 * Above the activity list, a strip counts the last day by filter. It is left
 * off Problems, which is not activity, and off a day with nothing in it,
 * where the list's own empty state already says so.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
} from 'react-native';

import { useTranslation } from 'react-i18next';
import {
  InkButton,
  InkChoice,
  InkEmptyState,
  InkNotice,
  InkSpinner,
  InkText,
} from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { selectionTick } from '@/services/haptics';
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
import { useActivity } from '@/view-models/use-activity';
import { useActivitySummary } from '@/view-models/use-activity-summary';
import { useProblems } from '@/view-models/use-problems';
import { formatRelativeTime } from '@/view-models/use-recent-sessions';
import { Grey, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { useThemedStyles } from '@/hooks/use-themed-styles';
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
  const color = item.level.toUpperCase() === 'ERROR' ? Semantic.danger : Semantic.warning;
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
  const { summary } = useActivitySummary().data;
  const showingProblems = activeTab === 'error';
  // Problems spans no activity category, so on that filter this asks the Pond nothing.
  const activity = useActivity(activeTab);
  const problems = useProblems(showingProblems);
  const { loading, error, actions } = showingProblems ? problems : activity;
  const failed = !showingProblems && activity.failed;
  const data = activity.data;

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
      {!showingProblems && summary && summary.total > 0 ? <TodayStrip summary={summary} /> : null}
      {loading ? <InkSpinner label={t('activity.loading')} /> : null}
      {/* A failed read with nothing to add still says so: the connection banner gives the cause. */}
      {error || failed ? (
        <View style={styles.notice}>
          <InkNotice tone="danger">{error ?? t('activity.failed')}</InkNotice>
          <InkButton variant="quiet" icon="refresh" onPress={actions.refresh}>
            {t('common.retry')}
          </InkButton>
        </View>
      ) : null}
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

      {showingProblems ? (
        <FlatList
          data={problems.data.problems}
          keyExtractor={problemKey}
          renderItem={renderProblem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={header}
          ListEmptyComponent={
            !loading && !error ? (
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
          ListHeaderComponent={header}
          // A list that failed to load is unknown, not empty.
          ListEmptyComponent={
            !loading && !error && !failed ? (
              <InkEmptyState icon="logs" title={t('activity.empty')}>
                <InkText>{t('activity.emptyBody')}</InkText>
              </InkEmptyState>
            ) : null
          }
        />
      )}
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
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    lineHeight: FontSize.base * 1.5,
    color: c.text,
  },
  logDetail: {
    fontFamily: FontFamily.body,
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
    fontFamily: FontFamily.mono,
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
    fontFamily: FontFamily.body,
    fontSize: 10,
    fontWeight: FontWeight.bold,
    color: c.textSecondary,
  },
  notice: { gap: Spacing.sm, marginBottom: Spacing.md },

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
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: c.text,
  },
  todayCounts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.md },
  todayCount: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: c.textSecondary,
  },
});
