// A long task the assistant started in this conversation, followed live where its `task_start` call
// sits. It lies flat on a hairline, like the other tool cards, so it never outranks the answer.

import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkEdge, InkEyebrow, InkSheet, InkSpinner, inkText, useInkTheme } from '@jarida/ink/native';

import { Markdown } from '@/components/patterns/markdown';
import { GIcon } from '@/components/ui/g-icon';
import { GSheetBody } from '@/components/ui/g-sheet-body';
import { isEnded, resultArtifact } from '@/models/long-tasks';
import { useConfirm } from '@/providers/confirm-provider';
import { confirm, reject, tap } from '@/services/haptics';
import type { LongTaskStep } from '@/services/types';
import { builtInName } from '@/view-models/agent-words';
import { progressLine, stepStateLabel, taskEyebrow, taskStateIcon, taskStateLabel, taskStateNote } from '@/view-models/long-task-words';
import { useLongTask } from '@/view-models/use-long-task';

function Step({ step, first }: { step: LongTaskStep; first: boolean }) {
  const theme = useInkTheme();
  const name = inkText(theme, { size: 'sm', weight: theme.weight.semibold });
  const meta = inkText(theme, { role: 'mono', size: 'xs', color: theme.color.textTertiary });
  const body = inkText(theme, { size: 'sm', color: theme.color.textSecondary });
  const failed = inkText(theme, { size: 'sm', color: theme.color.dangerFg });
  const done = step.state === 'completed';
  return (
    <View style={[styles.step, first ? null : { borderTopWidth: theme.edge.hairlineWidth, borderTopColor: theme.color.line }]}>
      <GIcon name={done ? 'check' : step.state === 'running' ? 'activity' : step.state === 'failed' ? 'warn' : 'minus'} size={14} color={done ? theme.color.text : theme.color.textTertiary} />
      <View style={styles.stepText}>
        <View style={styles.stepHead}>
          <Text style={[name.style, styles.shrink]} numberOfLines={1}>
            {builtInName(step.role)}
          </Text>
          <Text style={meta.style}>{stepStateLabel(step.state)}</Text>
        </View>
        {step.summary ? <Text style={body.style}>{step.summary}</Text> : null}
        {step.failure ? <Text style={failed.style}>{step.failure}</Text> : null}
      </View>
    </View>
  );
}

export const LongTaskCard = React.memo(function LongTaskCard({ taskId, callId }: { taskId: string; callId: string }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const ask = useConfirm();
  const { task, error, gone, stopping, stopError, notice, result, actions } = useLongTask(taskId);

  const stop = useCallback(async () => {
    const yes = await ask({
      title: t('chat.longTask.stopConfirmTitle'),
      message: t('chat.longTask.stopConfirmBody'),
      confirmLabel: t('chat.longTask.stop'),
      destructive: true,
    });
    if (!yes) return;
    const stopped = await actions.stop();
    void (stopped ? confirm() : reject());
  }, [actions, ask, t]);

  const goal = inkText(theme, { size: 'base', weight: theme.weight.semibold, leading: 'snug' });
  const line = inkText(theme, { size: 'sm', weight: theme.weight.medium });
  const quiet = inkText(theme, { size: 'sm', color: theme.color.textSecondary });
  const danger = inkText(theme, { size: 'sm', weight: theme.weight.medium, color: theme.color.dangerFg });

  const ended = task ? isEnded(task.state) : false;
  const answer = task ? resultArtifact(task) : null;
  const note = task ? taskStateNote(task.state) : null;

  return (
    <InkEdge raised={false} budgeted={false} radius={theme.radius.lg} contentStyle={styles.card}>
      <InkEyebrow>{taskEyebrow(task?.kind ?? null, callId)}</InkEyebrow>

      {gone ? <Text style={quiet.style}>{t('chat.longTask.gone')}</Text> : null}
      {!task && !gone && !error ? <InkSpinner label={t('chat.longTask.loading')} size={16} /> : null}
      {!task && error ? (
        <View style={styles.row}>
          <Text style={[quiet.style, styles.shrink]}>{error}</Text>
          <InkButton variant="quiet" icon="refresh" onPress={() => void actions.retry()}>
            {t('common.retry')}
          </InkButton>
        </View>
      ) : null}

      {task ? (
        <>
          <Text style={goal.style}>{task.goal}</Text>
          {/* Polite, so a state that changes while the card is on screen is announced. */}
          <View style={styles.row} accessibilityLiveRegion="polite">
            <GIcon name={taskStateIcon(task.state)} size={15} color={task.state === 'failed' ? theme.color.dangerFg : theme.color.text} />
            <Text style={line.style}>{taskStateLabel(task.state)}</Text>
            <Text style={[quiet.style, styles.shrink]}>{progressLine(task.steps)}</Text>
          </View>
          {note ? <Text style={quiet.style}>{note}</Text> : null}

          {task.steps.length > 0 ? (
            <View>
              {task.steps.map((step, i) => (
                <Step key={step.key} step={step} first={i === 0} />
              ))}
            </View>
          ) : null}

          {answer ? (
            <View style={styles.result}>
              <InkEyebrow>{t('chat.longTask.result')}</InkEyebrow>
              <Text style={line.style}>{answer.title}</Text>
              {answer.summary ? <Text style={quiet.style}>{answer.summary}</Text> : null}
              <View style={styles.actions}>
                <InkButton
                  variant="quiet"
                  icon="file"
                  onPress={() => {
                    void tap();
                    void actions.openResult();
                  }}
                >
                  {t('chat.longTask.readResult')}
                </InkButton>
              </View>
            </View>
          ) : task.state === 'completed' ? (
            <Text style={quiet.style}>{t('chat.longTask.noResult')}</Text>
          ) : null}

          {notice ? <Text style={quiet.style}>{notice}</Text> : null}
          {stopError ? (
            <Text accessibilityRole="alert" style={danger.style}>
              {stopError}
            </Text>
          ) : null}
          {ended ? null : (
            <View style={styles.actions}>
              <InkButton variant="quiet" icon="stop" onPress={() => void stop()} disabled={stopping}>
                {stopping ? t('chat.longTask.stopping') : t('chat.longTask.stop')}
              </InkButton>
            </View>
          )}
        </>
      ) : null}

      <InkSheet open={result.open} onClose={actions.closeResult} title={result.body?.title || answer?.title || t('chat.longTask.result')}>
        <GSheetBody>
          <ScrollView contentContainerStyle={styles.sheet}>
            {result.loading ? <InkSpinner label={t('chat.longTask.resultLoading')} /> : null}
            {result.error ? <Text style={danger.style}>{result.error}</Text> : null}
            {result.body ? <Markdown source={result.body.body} /> : null}
          </ScrollView>
        </GSheetBody>
      </InkSheet>
    </InkEdge>
  );
});

const styles = StyleSheet.create({
  card: { padding: 14, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  shrink: { flexShrink: 1 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  stepText: { flex: 1, gap: 2 },
  stepHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  result: { gap: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-start', gap: 8 },
  sheet: { padding: 16, gap: 12 },
});
