/**
 * DebugScreen — developer mode on a Jarida test Pond (issue #165).
 *
 * The debug switch comes first because it decides what the log below may show: off, members'
 * names and words read `[redacted]` there, as on any Pond; on, they read as said. Then the
 * model chat runs on, with a way back to the last one that answered, how long the latest
 * commands took, and the Pond's log as it is written, newest first.
 *
 * A home Pond refuses all of it, so the screen says so and opens nothing. The Advanced settings
 * page lists this screen only on a test Pond; the check here covers a link that reaches it anyway.
 */

import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkEmptyState, InkNotice, InkSpinner, InkSwitch, InkText } from '@jarida/ink/native';

import { useConfirm } from '@/providers/confirm-provider';
import { caution, confirm as confirmHaptic, selectionTick } from '@/services/haptics';
import type { LogEntry } from '@/services/types';
import { GPressable } from '@/components/ui/g-pressable';
import { describeCommand, describeLine, formatDuration, modelLabel, type CommandTiming, type LogItem } from '@/models/debug';
import { parsePondLogTime } from '@/models/log';
import { useDebug, type StreamState } from '@/view-models/use-debug';
import { Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';

const LEVEL_COLOR: Record<string, string> = {
  ERROR: Semantic.danger,
  WARN: Semantic.warning,
};

const STREAM_KEY: Record<StreamState, 'debug.stream.connecting' | 'debug.stream.live' | 'debug.stream.busy' | 'debug.stream.offline'> = {
  connecting: 'debug.stream.connecting',
  live: 'debug.stream.live',
  busy: 'debug.stream.busy',
  offline: 'debug.stream.offline',
};

/** `HH:MM:SS` in this phone's time, from the Pond's zone-less UTC. */
function clockTime(timestamp: string): string {
  const d = new Date(parsePondLogTime(timestamp));
  return Number.isNaN(d.getTime()) ? timestamp : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** A line as a sentence; tapped, as the Pond wrote it, for when the sentence is not enough. */
const LogLine = React.memo(function LogLine({ entry, repeats = 1 }: { entry: LogEntry; repeats?: number }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const [raw, setRaw] = useState(false);
  const { text, detail } = describeLine(entry, t);
  const color = LEVEL_COLOR[entry.level.toUpperCase()];
  return (
    <GPressable onPress={() => setRaw((r) => !r)} accessibilityRole="button" style={styles.line}>
      <View style={styles.lineTop}>
        <Text style={styles.lineTime}>{clockTime(entry.timestamp)}</Text>
        <Text style={[styles.lineText, color ? { color } : null]}>
          {text}
          {repeats > 1 ? <Text style={styles.lineDetail}>{`  ${t('debug.log.repeats', { count: repeats })}`}</Text> : null}
        </Text>
      </View>
      {detail ? <Text style={styles.lineDetail}>{detail}</Text> : null}
      {raw ? (
        <Text style={styles.raw} selectable>
          {`${entry.level} ${entry.source}\n${entry.message}${entry.metadata ? `\n${entry.metadata}` : ''}`}
        </Text>
      ) : null}
    </GPressable>
  );
});

/** A chat message's lines under one heading, in the order they happened. */
const CommandGroup = React.memo(function CommandGroup({ item }: { item: Extract<LogItem, { type: 'command' }> }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { warmUp, startedAt, totalMs, running } = describeCommand(item);
  const took = totalMs !== null ? formatDuration(totalMs) : running ? t('debug.group.running') : null;
  return (
    <View style={styles.command}>
      <View style={styles.commandHead}>
        <Text style={styles.commandTitle}>{warmUp ? t('debug.group.warmUp') : t('debug.group.command')}</Text>
        <Text style={styles.commandTime}>
          {took
            ? `${t('debug.group.startedAt', { time: clockTime(startedAt) })} · ${took}`
            : t('debug.group.startedAt', { time: clockTime(startedAt) })}
        </Text>
      </View>
      {item.lines.map((entry) => (
        <LogLine key={entry.id} entry={entry} />
      ))}
    </View>
  );
});

/** The timing table's columns, one per row and once as its heading. */
function TimingColumns({ cells, heading = false }: { cells: [string, string, string]; heading?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.timingRow, heading && styles.timingHeading]}>
      {cells.map((cell, i) => (
        <Text key={i} style={heading ? styles.timingHead : styles.timingCell}>
          {cell}
        </Text>
      ))}
    </View>
  );
}

function TimingTable({ timings }: { timings: CommandTiming[] }) {
  const { t } = useTranslation();
  return (
    <View>
      <TimingColumns heading cells={[t('debug.timing.firstWord'), t('debug.timing.finished'), t('debug.timing.took')]} />
      {timings.map((timing) => (
        <TimingColumns
          key={timing.id}
          cells={[
            timing.firstTokenMs !== null ? formatDuration(timing.firstTokenMs) : '–',
            clockTime(timing.timestamp),
            formatDuration(timing.totalMs),
          ]}
        />
      ))}
    </View>
  );
}

export default function DebugScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const ask = useConfirm();
  const { data, loading, busy, error, actions } = useDebug();

  const toggleDebug = useCallback(
    (next: boolean) => {
      void selectionTick();
      void actions.setDebug(next);
    },
    [actions],
  );

  const rollbackTo = data.chat?.rollback ?? null;
  const rollback = useCallback(async () => {
    if (!rollbackTo) return;
    void caution();
    const yes = await ask({
      title: t('debug.model.rollbackTitle'),
      message: t('debug.model.rollbackMessage', { model: modelLabel(rollbackTo.model_id) }),
      confirmLabel: t('debug.model.rollbackConfirm'),
    });
    if (!yes) return;
    if (await actions.rollback()) void confirmHaptic();
  }, [actions, ask, rollbackTo, t]);

  const keyExtractor = useCallback((item: LogItem) => item.key, []);
  const renderItem = useCallback(
    ({ item }: { item: LogItem }) =>
      item.type === 'command' ? <CommandGroup item={item} /> : <LogLine entry={item.entry} repeats={item.repeats} />,
    [],
  );

  if (data.testPond === null) {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          {loading ? <InkSpinner label={t('debug.loading')} /> : null}
          {error ? (
            <View style={styles.notice}>
              <InkNotice tone="danger">{error}</InkNotice>
              <InkButton variant="quiet" icon="refresh" onPress={actions.refresh}>
                {t('common.retry')}
              </InkButton>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  if (!data.testPond) {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <InkEmptyState icon="cpu" title={t('debug.homePond.title')}>
            <InkText>{t('debug.homePond.body')}</InkText>
          </InkEmptyState>
        </View>
      </View>
    );
  }

  const header = (
    <View>
      {error ? (
        <View style={styles.notice}>
          <InkNotice tone="danger">{error}</InkNotice>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>{t('debug.switch.title')}</Text>
      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.label}>{t('debug.switch.label')}</Text>
            <Text style={styles.hint}>{data.debug ? t('debug.switch.onHint') : t('debug.switch.offHint')}</Text>
          </View>
          <InkSwitch checked={data.debug} disabled={busy.debug} onChange={toggleDebug} />
        </View>
      </View>
      <Text style={styles.footer}>{t('debug.switch.footer')}</Text>

      <Text style={styles.sectionTitle}>{t('debug.model.title')}</Text>
      <View style={styles.card}>
        <Text style={styles.label} selectable>
          {data.chat?.model_id ? modelLabel(data.chat.model_id) : t('debug.model.none')}
        </Text>
        {data.chat?.provider ? <Text style={styles.hint}>{data.chat.provider}</Text> : null}
        <View style={styles.rollback}>
          {rollbackTo ? (
            <InkButton variant="quiet" icon="refresh" disabled={busy.rollback} onPress={() => void rollback()}>
              {busy.rollback
                ? t('debug.model.rollingBack')
                : t('debug.model.rollback', { model: modelLabel(rollbackTo.model_id) })}
            </InkButton>
          ) : (
            <Text style={styles.hint}>{t('debug.model.noRollback')}</Text>
          )}
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t('debug.timing.title')}</Text>
      <View style={styles.card}>
        {data.timings.length === 0 ? (
          <Text style={styles.hint}>{t('debug.timing.empty')}</Text>
        ) : (
          <TimingTable timings={data.timings} />
        )}
      </View>

      <View style={styles.logHeader}>
        <Text style={styles.sectionTitle}>{t('debug.log.title')}</Text>
        <Text style={[styles.streamState, data.stream === 'live' && styles.streamLive]}>
          {t(STREAM_KEY[data.stream])}
        </Text>
      </View>
      {data.skipped > 0 ? (
        <Text style={styles.hint}>{t('debug.log.skipped', { count: data.skipped })}</Text>
      ) : null}
      <Text style={styles.hint}>{data.lines.length === 0 ? t('debug.log.empty') : t('debug.log.showRaw')}</Text>
    </View>
  );

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={data.items}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      ListHeaderComponent={header}
      initialNumToRender={30}
    />
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    content: { padding: Spacing.lg, paddingBottom: Spacing['3xl'] },
    notice: { gap: Spacing.sm, marginBottom: Spacing.md },

    sectionTitle: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: c.text,
      marginBottom: Spacing.sm,
      marginTop: Spacing.lg,
    },
    card: {
      backgroundColor: c.card,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: Spacing.md,
    },
    footer: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.sm,
      color: c.textTertiary,
      marginTop: Spacing.sm,
      lineHeight: FontSize.sm * 1.5,
    },
    label: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
      color: c.text,
    },
    hint: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.sm,
      color: c.textTertiary,
      marginTop: 2,
      lineHeight: FontSize.sm * 1.5,
    },

    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    switchText: { flex: 1, marginRight: Spacing.md },
    rollback: { marginTop: Spacing.md, alignItems: 'flex-start' },

    timingRow: { flexDirection: 'row', paddingVertical: Spacing.xs },
    timingHeading: { borderBottomWidth: 1, borderBottomColor: c.border, paddingBottom: Spacing.sm },
    timingHead: {
      flex: 1,
      fontFamily: FontFamily.body,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
      color: c.textTertiary,
    },
    timingCell: { flex: 1, fontFamily: FontFamily.mono, fontSize: FontSize.sm, color: c.text },

    logHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    streamState: { fontFamily: FontFamily.body, fontSize: FontSize.sm, color: c.textTertiary },
    streamLive: { color: Semantic.success },
    line: { paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border },
    lineTop: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
    lineTime: { fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: c.textTertiary },
    lineText: { flex: 1, fontFamily: FontFamily.body, fontSize: FontSize.sm, color: c.text },
    lineDetail: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.xs,
      color: c.textTertiary,
      marginTop: 2,
      marginLeft: 64,
    },
    raw: {
      fontFamily: FontFamily.mono,
      fontSize: FontSize.xs,
      color: c.textTertiary,
      marginTop: Spacing.xs,
      padding: Spacing.sm,
      borderRadius: Radii.sm,
      backgroundColor: c.background,
    },
    command: {
      marginTop: Spacing.md,
      backgroundColor: c.card,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
    },
    commandHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    commandTitle: { fontFamily: FontFamily.body, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: c.text },
    commandTime: { fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: c.textTertiary },
  });
