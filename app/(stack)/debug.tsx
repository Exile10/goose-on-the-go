/**
 * DebugScreen — what the Pond is doing right now, for a developer finding out why something went
 * wrong (issue #165): the debug switch, which model holds each job, how long the latest commands
 * took, and the Pond's log as it is written, newest first.
 *
 * The debug switch comes first because it decides what the log below may show: off, members'
 * names and words read `[redacted]` there, as on any Pond; on, they read as said.
 *
 * A home Pond refuses all of it, so the screen says so and opens nothing. The Advanced page lists
 * this screen only on a test Pond; the check here covers a link that reaches it anyway. Dev builds
 * only for now, like the Developer screen it opens from. The journey gives it to a developer role
 * on test Ponds; when the Pond has roles (jarida-io/goose-in-a-pond#616), that check replaces
 * `__DEV__`.
 *
 * A list, not a scroll view: the log is a live stream holding up to `LOG_LINES_KEPT` lines, and
 * everything above it rides in the list's header so the lines themselves stay virtualised.
 */

import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkEmptyState, InkButton, InkSpinner, InkSwitch, InkText } from '@/components/ui/ink';

import { TelemetryCard, TurnsSheet } from '@/components/patterns/conversation-telemetry';
import { SettingsGroup, SettingsHeader, SettingsRow } from '@/components/settings/settings-list';
import { SettingsScroll } from '@/components/settings/settings-scroll';
import { GPressable } from '@/components/ui/g-pressable';
import { useConfirm } from '@/providers/confirm-provider';
import { holderOf, MODEL_ROLES, titleOf } from '@/models/model-library';
import {
  describeCommand,
  describeLine,
  deviceCommandLabel,
  formatDuration,
  modelLabel,
  type CommandTiming,
  type LogItem,
} from '@/models/debug';
import { parsePondLogTime } from '@/models/log';
import { caution, confirm as confirmHaptic, selectionTick } from '@/services/haptics';
import type { LogEntry } from '@/services/types';
import { useDebug, type StreamState } from '@/view-models/use-debug';
import { useConversationTelemetry, useConversationTurns } from '@/view-models/use-conversation-telemetry';
import { roleLabelKey, useModelLibrary } from '@/view-models/use-model-library';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { Semantic, type ThemeColors } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';

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

function TimingTable({ timings, deviceNames }: { timings: CommandTiming[]; deviceNames: ReadonlyMap<string, string> }) {
  const { t } = useTranslation();
  return (
    <View>
      <TimingColumns heading cells={[t('debug.timing.command'), t('debug.timing.finished'), t('debug.timing.took')]} />
      {timings.map((timing) => (
        <TimingColumns
          key={timing.id}
          cells={[
            // What the command was: a device and what it was told, or a reply and its first word.
            timing.device
              ? deviceCommandLabel(timing.device, deviceNames, t)
              : timing.firstTokenMs !== null
                ? t('debug.timing.reply', { time: formatDuration(timing.firstTokenMs) })
                : t('debug.timing.replyNoTime'),
            clockTime(timing.timestamp),
            formatDuration(timing.totalMs),
          ]}
        />
      ))}
    </View>
  );
}

export default function DebugScreen() {
  // Kept apart from the content so its hooks run only when it renders; see DeveloperScreen.
  if (!__DEV__) return <Redirect href="/(tabs)" />;
  return <DebugScreenContent />;
}

function DebugScreenContent() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const ask = useConfirm();
  const debug = useDebug();
  const lib = useModelLibrary();
  const { latest } = useConversationTelemetry().data;
  const turns = useConversationTurns();
  const [turnsOpen, setTurnsOpen] = useState(false);

  // Pause freezes what is on screen rather than the stream behind it: the lines keep arriving, so
  // resuming shows the log as it is now instead of replaying a backlog nobody was reading. The
  // snapshot is state, not a ref -- a ref written while rendering is read back by whatever renders
  // next, which React promises nothing about.
  const [frozen, setFrozen] = useState<LogItem[] | null>(null);
  const paused = frozen !== null;
  const items = frozen ?? debug.data.items;

  const openTurns = () => {
    if (!latest) return;
    setTurnsOpen(true);
    void turns.actions.load(latest.session.id);
  };

  const rollbackTo = debug.data.chat?.rollback ?? null;
  const rollback = async () => {
    if (!rollbackTo) return;
    void caution();
    const yes = await ask({
      title: t('debug.model.rollbackTitle'),
      message: t('debug.model.rollbackMessage', { model: modelLabel(rollbackTo.model_id) }),
      confirmLabel: t('debug.model.rollbackConfirm'),
    });
    if (!yes) return;
    if (await debug.actions.rollback()) void confirmHaptic();
  };

  const keyExtractor = useCallback((item: LogItem) => item.key, []);
  const renderItem = useCallback(
    ({ item }: { item: LogItem }) =>
      item.type === 'command' ? <CommandGroup item={item} /> : <LogLine entry={item.entry} repeats={item.repeats} />,
    [],
  );

  const pageHeader = (
    <SettingsHeader icon="cpu" tile="slate" title={t('screens.debug')} description={t('debug.intro')} />
  );

  // Asked each time the screen opens: the same phone may be paired to a home Pond tomorrow.
  if (debug.data.testPond === null) {
    return (
      <SettingsScroll>
        {pageHeader}
        {debug.loading ? <InkSpinner label={t('debug.loading')} /> : null}
        {debug.error ? (
          <SettingsGroup>
            <SettingsRow label={debug.error} action icon="refresh" onPress={() => void debug.actions.refresh()} />
          </SettingsGroup>
        ) : null}
      </SettingsScroll>
    );
  }

  if (!debug.data.testPond) {
    return (
      <SettingsScroll>
        {pageHeader}
        <InkEmptyState icon="cpu" title={t('debug.homePond.title')}>
          <InkText>{t('debug.homePond.body')}</InkText>
        </InkEmptyState>
      </SettingsScroll>
    );
  }

  const header = (
    <View>
      {pageHeader}

      <SettingsGroup title={t('debug.switch.title')} footer={t('debug.switch.footer')}>
        <SettingsRow
          label={t('debug.switch.label')}
          description={debug.data.debug ? t('debug.switch.onHint') : t('debug.switch.offHint')}
          accessibilityRole="switch"
          accessibilityState={{ checked: debug.data.debug, busy: debug.busy.debug }}
          trailing={
            <InkSwitch
              checked={debug.data.debug}
              disabled={debug.busy.debug}
              onChange={(next) => {
                void selectionTick();
                void debug.actions.setDebug(next);
              }}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t('debug.model.title')}>
        <SettingsRow
          label={debug.data.chat?.model_id ? modelLabel(debug.data.chat.model_id) : t('debug.model.none')}
          description={debug.data.chat?.provider ?? null}
        />
        {rollbackTo ? (
          <SettingsRow
            label={
              debug.busy.rollback
                ? t('debug.model.rollingBack')
                : t('debug.model.rollback', { model: modelLabel(rollbackTo.model_id) })
            }
            icon="refresh"
            action
            disabled={debug.busy.rollback}
            onPress={() => void rollback()}
          />
        ) : (
          <SettingsRow label={t('debug.model.noRollback')} />
        )}
      </SettingsGroup>

      <SettingsGroup title={t('debug.models.title')}>
        {MODEL_ROLES.map((role) => {
          const holder = holderOf(lib.models, role);
          return (
            <SettingsRow
              key={role}
              label={t(roleLabelKey(role))}
              value={holder ? titleOf(holder) : t('debug.models.none')}
              accessory="next"
              onPress={() => {
                void selectionTick();
                // The voice is chosen on its own page, as from Models.
                if (role === 'tts') router.push('/(stack)/settings-speaking');
                else router.push({ pathname: '/(stack)/settings-model-role', params: { role } });
              }}
            />
          );
        })}
      </SettingsGroup>

      {/* The Pond's own telemetry for the latest conversation, which the log cannot show: the
          tools a turn used, behind a tap. */}
      {/* On its own, not in a group: the card is raised and pressable, and a group's edge drawn
          around it showed under it as an overlap. */}
      <Text style={styles.sectionTitle}>{t('debug.timings.title')}</Text>
      {latest ? (
        <TelemetryCard latest={latest} onOpen={openTurns} />
      ) : (
        <View style={styles.card}>
          <Text style={styles.hint}>{t('debug.timings.none')}</Text>
        </View>
      )}
      <Text style={styles.footer}>{t('debug.timings.footer')}</Text>

      <Text style={styles.sectionTitle}>{t('debug.timing.title')}</Text>
      <View style={styles.card}>
        {debug.data.timings.length === 0 ? (
          <Text style={styles.hint}>{t('debug.timing.empty')}</Text>
        ) : (
          <TimingTable timings={debug.data.timings} deviceNames={debug.data.deviceNames} />
        )}
      </View>

      <View style={styles.logHeader}>
        <Text style={styles.sectionTitle}>{t('debug.log.title')}</Text>
        <View style={styles.logHeadRight}>
          <Text style={[styles.streamState, debug.data.stream === 'live' && styles.streamLive]}>
            {t(STREAM_KEY[debug.data.stream])}
          </Text>
          <InkButton
            variant="quiet"
            icon={paused ? 'play' : 'pause'}
            onPress={() => {
              void selectionTick();
              setFrozen((was) => (was ? null : debug.data.items));
            }}
          >
            {paused ? t('debug.logs.resume') : t('debug.logs.pause')}
          </InkButton>
        </View>
      </View>
      {debug.data.skipped > 0 ? (
        <Text style={styles.hint}>{t('debug.log.skipped', { count: debug.data.skipped })}</Text>
      ) : null}
      <Text style={styles.hint}>{items.length === 0 ? t('debug.log.empty') : t('debug.log.showRaw')}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={header}
        initialNumToRender={30}
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

    logHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.md },
    logHeadRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
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
