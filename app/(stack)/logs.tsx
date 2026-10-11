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
import type { ActivityEvent } from '@/services/types';
import {
  ACTIVITY_FILTERS,
  categoryIcon,
  describeEvent,
  eventFilter,
  eventKeys,
  filterLabelKey,
  type ActivityFilter,
} from '@/models/log';
import { useActivity } from '@/view-models/use-activity';
import { formatRelativeTime } from '@/view-models/use-recent-sessions';
import { Grey } from '@/constants/colors';
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

export default function ActivityScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ActivityFilter>('all');
  const { data, loading, error, failed, actions } = useActivity(activeTab);

  const renderItem = useCallback(
    ({ item }: { item: ActivityEvent }) => <EventRow item={item} showType={activeTab === 'all'} />,
    [activeTab],
  );

  // Keyed once per read. The index only finds an event's key; the key itself
  // holds no position, so a row keeps it when a poll adds newer ones above.
  const keys = useMemo(() => eventKeys(data.events), [data.events]);
  const keyExtractor = useCallback((_item: ActivityEvent, index: number) => keys[index], [keys]);

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

      {/* Activity list */}
      <FlatList
        data={data.events}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        // A poll puts newer events above; this keeps the row being read where it is.
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
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
        }
        // A list that failed to load is unknown, not empty.
        ListEmptyComponent={
          !loading && !error && !failed ? (
            <InkEmptyState icon="logs" title={t('activity.empty')}>
              <InkText>{t('activity.emptyBody')}</InkText>
            </InkEmptyState>
          ) : null
        }
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
});
