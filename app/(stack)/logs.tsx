/**
 * ActivityScreen — what Goose has been doing, newest first.
 *
 * Filters are named for what a reader is looking for rather than for the enum
 * behind them: `mcp` reads as "Tools", because a household is looking for the
 * thing Goose reached out to, not for the protocol it used to do it.
 *
 * The type badge appears only in the unfiltered view. Once every row is an
 * action, a badge on each one reading "Actions" is the filter repeated.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
} from 'react-native';

import { useTranslation } from 'react-i18next';
import { InkChoice, InkEmptyState, InkText } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { selectionTick } from '@/services/haptics';
import { SAMPLE_LOGS, type LogEntry, type LogType } from '@/models/log';
import { Grey, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';

const LOG_TABS: (LogType | 'all')[] = ['all', 'action', 'mcp', 'system', 'error'];

const LEVEL_COLORS: Record<string, string> = {
  info: Grey[600],
  warn: Semantic.warning,
  error: Semantic.danger,
};

const LogRow = React.memo(function LogRow({
  item,
  showType,
}: {
  item: LogEntry;
  showType: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const levelColor = LEVEL_COLORS[item.level] ?? Grey[600];
  return (
    <View style={styles.logRow}>
      <View style={{ marginRight: Spacing.md, marginTop: 2 }}>
        <GIcon name={item.icon} size={16} color={levelColor} />
      </View>
      <View style={styles.logBody}>
        <Text
          style={[styles.logText, item.level === 'error' && { color: Semantic.danger }]}
        >
          {item.text}
        </Text>
        <View style={styles.logMeta}>
          <Text style={styles.logTime}>{item.time}</Text>
          {showType ? (
            <View style={[styles.typeBadge, { backgroundColor: levelColor + '18' }]}>
              <Text style={[styles.typeText, { color: levelColor }]}>
                {t(`activity.${item.type}` as const)}
              </Text>
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
  const [activeTab, setActiveTab] = useState<LogType | 'all'>('all');

  const filtered = activeTab === 'all'
    ? SAMPLE_LOGS
    : SAMPLE_LOGS.filter((l) => l.type === activeTab);

  const renderItem = useCallback(
    ({ item }: { item: LogEntry }) => <LogRow item={item} showType={activeTab === 'all'} />,
    [activeTab],
  );

  const keyExtractor = useCallback(
    (_: LogEntry, index: number) => String(index),
    [],
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
        {LOG_TABS.map((tab) => (
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
            {t(`activity.${tab}` as const)}
          </InkChoice>
        ))}
      </ScrollView>

      {/* Log list */}
      <FlatList
        data={filtered}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <InkEmptyState icon="logs" title={t('activity.empty')}>
            <InkText>{t('activity.emptyBody')}</InkText>
          </InkEmptyState>
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
  logBody: { flex: 1 },
  logText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    lineHeight: FontSize.base * 1.5,
    color: c.text,
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
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radii.pill,
  },
  typeText: {
    fontFamily: FontFamily.body,
    fontSize: 10,
    fontWeight: FontWeight.bold,
  },
});
