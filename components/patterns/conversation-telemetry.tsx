/**
 * The Activity screen's view of how Goose's latest conversation went (issue
 * #15): a card with the conversation's averages, and a sheet with each turn.
 *
 * The figures are named for what a person notices rather than for the metric:
 * time to first token is how long before Goose starts answering, completion
 * tokens is how long the answer was.
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkNotice, InkSheet, InkSpinner, InkText } from '@jarida/ink/native';

import { formatDuration, formatPercent } from '@/models/telemetry';
import type { TurnMetrics } from '@/services/types';
import type { ConversationTelemetry, UseConversationTurns } from '@/view-models/use-conversation-telemetry';
import { Spacing } from '@/constants/spacing';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <InkText size="xs" tone="secondary">{label}</InkText>
      <InkText weight="semibold">{value}</InkText>
    </View>
  );
}

export function TelemetryCard({ latest, onOpen }: { latest: ConversationTelemetry; onOpen: () => void }) {
  const { t } = useTranslation();
  const { session, summary } = latest;
  return (
    <InkCard pressable onPress={onOpen} style={styles.card}>
      <InkText size="xs" tone="secondary">{t('activity.telemetry.eyebrow')}</InkText>
      <InkText weight="semibold">{session.title || t('activity.telemetry.untitled')}</InkText>
      <View style={styles.stats}>
        <Stat label={t('activity.telemetry.turns')} value={String(summary.total_turns)} />
        <Stat label={t('activity.telemetry.firstWord')} value={formatDuration(summary.avg_ttft_ms)} />
        <Stat
          label={t('activity.telemetry.replyLength')}
          value={t('activity.telemetry.tokens', { count: Math.round(summary.avg_completion_tokens) })}
        />
        <Stat label={t('activity.telemetry.context')} value={formatPercent(summary.avg_context_utilization)} />
      </View>
    </InkCard>
  );
}

function TurnRow({ turn }: { turn: TurnMetrics }) {
  const { t } = useTranslation();
  return (
    <View style={styles.turn}>
      <InkText weight="semibold">
        {t('activity.telemetry.turnTitle', { number: turn.turn_number, model: turn.model_name })}
      </InkText>
      <InkText size="sm" tone="secondary">
        {t('activity.telemetry.turnDetail', {
          firstWord: formatDuration(turn.ttft_ms),
          total: formatDuration(turn.total_latency_ms),
          tokens: turn.completion_tokens,
        })}
      </InkText>
      {turn.tool_name ? (
        <InkText size="sm" tone="secondary" mono>
          {turn.tool_latency_ms === null
            ? turn.tool_name
            : t('activity.telemetry.tool', { tool: turn.tool_name, time: formatDuration(turn.tool_latency_ms) })}
        </InkText>
      ) : null}
    </View>
  );
}

export function TurnsSheet({
  open,
  title,
  turns,
  onClose,
  onRetry,
}: {
  open: boolean;
  title: string;
  turns: UseConversationTurns;
  onClose: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <InkSheet open={open} onClose={onClose} title={title}>
      <ScrollView style={styles.sheetList}>
        {turns.loading ? <InkSpinner label={t('activity.telemetry.loading')} /> : null}
        {turns.error ? (
          <View style={styles.notice}>
            <InkNotice tone="danger">{turns.error}</InkNotice>
            <InkButton variant="quiet" icon="refresh" onPress={onRetry}>
              {t('common.retry')}
            </InkButton>
          </View>
        ) : null}
        {turns.data.turns.map((turn) => (
          <TurnRow key={turn.turn_number} turn={turn} />
        ))}
      </ScrollView>
    </InkSheet>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.md },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.lg, marginTop: Spacing.xs },
  stat: { gap: 2 },
  sheetList: { maxHeight: 420 },
  turn: { paddingVertical: Spacing.sm, gap: 2 },
  notice: { gap: Spacing.sm },
});
