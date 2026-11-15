// Where a waiting task stands, on its card: who is ahead, and for the member's own tasks in the line a
// Keep going or Stop each, applied by one Stop button. Nothing at the front of the line.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkSegmented, inkText, useInkTheme } from '@/components/ui/ink';

import { confirm, reject, selectionTick } from '@/services/haptics';
import type { LongTask } from '@/services/types';
import { aheadWords, choiceGoal, placeWords, stopFailedWords, stoppedWords, stopPickedLabel } from '@/view-models/long-task-words';
import { useLongTaskQueue } from '@/view-models/use-long-task-queue';

type Choice = 'keep' | 'stop';

export function LongTaskQueue({ task, refresh }: { task: LongTask; refresh: () => Promise<void> }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const { waiting, choices, picked, applying, outcome, actions } = useLongTaskQueue(task, refresh);

  const quiet = inkText(theme, { size: 'sm', color: theme.color.textSecondary });
  const name = inkText(theme, { size: 'sm', weight: theme.weight.semibold });
  const meta = inkText(theme, { role: 'mono', size: 'xs', color: theme.color.textTertiary });
  const done = inkText(theme, { size: 'sm', weight: theme.weight.medium });
  const danger = inkText(theme, { size: 'sm', weight: theme.weight.medium, color: theme.color.dangerFg });

  // The outcome outlives the line: stopping the tasks ahead can bring this one to the front.
  if ((!waiting || !task.queue) && !outcome) return null;

  const stop = async () => {
    const all = await actions.stopPicked();
    void (all ? confirm() : reject());
  };

  return (
    <View style={styles.queue}>
      {waiting && task.queue ? <Text style={quiet.style}>{aheadWords(task.queue.ahead)}</Text> : null}

      {waiting && choices.length > 0 ? (
        <>
          <Text style={quiet.style}>{t('chat.longTask.queue.hint')}</Text>
          {choices.map((choice, i) => {
            const goal = choiceGoal(choice.goal, choice.isThis);
            const place = placeWords(choice.position);
            return (
              <View key={choice.id} style={[styles.row, i === 0 ? null : { borderTopWidth: theme.edge.hairlineWidth, borderTopColor: theme.color.line }]}>
                <View style={styles.head}>
                  <Text style={[name.style, styles.shrink]} numberOfLines={2}>
                    {goal}
                  </Text>
                  <Text style={meta.style}>{place}</Text>
                </View>
                <InkSegmented<Choice>
                  label={t('chat.longTask.queue.choiceLabel', { goal, place })}
                  value={picked.has(choice.id) ? 'stop' : 'keep'}
                  options={[
                    { value: 'keep', label: t('chat.longTask.queue.keep'), disabled: applying },
                    { value: 'stop', label: t('chat.longTask.queue.stop'), disabled: applying },
                  ]}
                  onChange={(value) => {
                    void selectionTick();
                    actions.choose(choice.id, value === 'stop');
                  }}
                />
              </View>
            );
          })}
          {picked.size > 0 ? (
            <View style={styles.actions}>
              <InkButton variant="danger" icon="stop" onPress={() => void stop()} disabled={applying}>
                {applying ? t('chat.longTask.queue.applying') : stopPickedLabel(picked.size)}
              </InkButton>
            </View>
          ) : outcome === null ? (
            <Text style={quiet.style}>{t('chat.longTask.queue.allKeep')}</Text>
          ) : null}
        </>
      ) : null}

      {outcome && outcome.stopped > 0 ? (
        <Text style={done.style} accessibilityLiveRegion="polite">
          {stoppedWords(outcome.stopped)}
        </Text>
      ) : null}
      {outcome && outcome.failures.length > 0 ? (
        <Text accessibilityRole="alert" style={danger.style}>
          {stopFailedWords(outcome.failures)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  queue: { gap: 8 },
  row: { gap: 8, paddingVertical: 8 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  shrink: { flexShrink: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-start', gap: 8 },
});
