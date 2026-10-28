/**
 * RunRow — one run of a schedule, under "Recent runs" on its screen.
 *
 * Closed, a run is its status, when it started, a few plain lines of what it
 * said or why it failed, and how long it took. Opened, it is all of it: the
 * agent's answer drawn by the chat's own renderer, or the whole error, both
 * selectable. The dashboard's history opens a run the same way.
 *
 * Each row opens on its own and stays open while another opens. Closing one
 * row when the next opens would pull everything below it up the screen, the
 * tapped row included, and comparing today's answer with yesterday's is a
 * reason to have both open.
 *
 * The press covers the head and the preview only. The opened body sits outside
 * it, so its text can be selected and its links followed without the row
 * taking the touch and closing.
 */

import React, { useState } from 'react';
import { LayoutAnimation, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkBadge, InkText, inkText, useInkTheme, useReduceMotion } from '@jarida/ink/native';
import type { InkTone } from '@jarida/ink';

import { Markdown } from '@/components/patterns/markdown';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Spacing } from '@/constants/spacing';
import { formatRunDuration, formatScheduleTime, runPreview } from '@/models/schedule';
import { selectionTick } from '@/services/haptics';
import type { TranslationKey } from '@/services/i18n';
import type { ScheduleRun } from '@/services/types';

/** The smallest touch target either platform's guidelines allow. */
const MIN_TOUCH = 44;

function runStatus(run: ScheduleRun): { tone: InkTone; key: TranslationKey } {
  switch (run.status) {
    case 'running':
      return { tone: 'brand', key: 'schedule.runs.statusRunning' };
    case 'completed':
      return { tone: 'success', key: 'schedule.runs.statusCompleted' };
    case 'failed':
      return { tone: 'danger', key: 'schedule.runs.statusFailed' };
  }
}

/** A run's result is what the agent said, and an error is why it did not. */
export const RunRow = React.memo(function RunRow({ run }: { run: ScheduleRun }) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const reduced = useReduceMotion();
  const [open, setOpen] = useState(false);
  const { tone, key } = runStatus(run);
  const failure = run.error ?? null;
  const output = failure ?? run.result ?? '';
  const preview = output ? runPreview(output) : null;
  const canOpen = preview?.truncated === true;
  const ink = failure ? theme.color.dangerFg : theme.color.textSecondary;
  const snippetText = inkText(theme, { size: 'sm', color: ink });

  const toggle = () => {
    void selectionTick();
    if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((was) => !was);
  };

  const head = (
    <>
      <View style={styles.runTop}>
        <InkBadge tone={tone}>{t(key)}</InkBadge>
        <View style={styles.when}>
          <InkText size="sm" tone="tertiary">{formatScheduleTime(run.started_at)}</InkText>
          {canOpen ? (
            <GIcon name={open ? 'chevron' : 'chevron-right'} size={16} color={theme.color.textTertiary} />
          ) : null}
        </View>
      </View>
      {preview && !open ? (
        <Text style={snippetText.style} selectable={!canOpen}>
          {preview.text}
        </Text>
      ) : null}
    </>
  );

  return (
    <View style={[styles.run, { borderBottomColor: theme.color.line }]}>
      {canOpen ? (
        <GPressable
          feedback="tint"
          onPress={toggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityHint={t(open ? 'schedule.runs.showLess' : 'schedule.runs.showAll')}
          style={[styles.head, { borderRadius: theme.radius.md }]}
        >
          {head}
        </GPressable>
      ) : (
        <View style={styles.head}>{head}</View>
      )}
      {open ? (
        failure ? (
          <Text style={snippetText.style} selectable>
            {failure}
          </Text>
        ) : (
          <Markdown source={output} />
        )
      ) : null}
      {run.duration_ms != null ? (
        <InkText size="xs" tone="tertiary" mono>
          {formatRunDuration(run.duration_ms)}
        </InkText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  run: {
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  head: { gap: Spacing.xs, minHeight: MIN_TOUCH, justifyContent: 'center' },
  runTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  when: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
});
