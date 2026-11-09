// A long task's whole report, read on its own page: a plan or research can run pages long, so it is
// not a chat card. Its sections are a tap apart, and Share hands it on as a document, a page or dates.

import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkChip, InkEyebrow, InkNotice, InkSpinner, inkText, useInkTheme } from '@/components/ui/ink';

import { Markdown } from '@/components/patterns/markdown';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useChoice } from '@/providers/confirm-provider';
import { confirm, reject, selectionTick } from '@/services/haptics';
import { taskEyebrow } from '@/view-models/long-task-words';
import { useTaskReport, type ShareFormat } from '@/view-models/use-task-report';

/** A task id from a link: only what the Pond issues, never anything that could be a path. */
function taskIdOf(param: string | string[] | undefined): string {
  const id = Array.isArray(param) ? param[0] : param;
  return id && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : '';
}

export default function TaskReportScreen() {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const styles = useThemedStyles(makeStyles);
  const choose = useChoice();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = taskIdOf(params.id);
  const { report, loading, error, gone, sharing, shareError, options, actions } = useTaskReport(id);
  const scroll = useRef<ScrollView>(null);
  // Where each section starts, measured as it lays out, so a chip can scroll straight to it.
  const [offsets, setOffsets] = useState<Record<number, number>>({});

  const jump = useCallback(
    (index: number) => {
      void selectionTick();
      scroll.current?.scrollTo({ y: Math.max(0, (offsets[index] ?? 0) - Spacing.md), animated: true });
    },
    [offsets],
  );

  const share = useCallback(async () => {
    const format = await choose<ShareFormat>({
      title: t('chat.report.shareTitle'),
      message: t('chat.report.shareBody'),
      options: options.map((o) => ({ label: t(o.labelKey), value: o.format })),
    });
    if (!format) return;
    const shared = await actions.share(format);
    void (shared ? confirm() : reject());
  }, [actions, choose, options, t]);

  const danger = inkText(theme, { size: 'sm', weight: theme.weight.medium, color: theme.color.dangerFg });
  const titled = report?.sections.filter((s) => s.title !== '') ?? [];

  return (
    <ScrollView ref={scroll} style={styles.page} contentContainerStyle={styles.content}>
      {loading && !report ? <InkSpinner label={t('chat.report.loading')} /> : null}
      {gone || !id ? <InkNotice tone="neutral">{t('chat.report.gone')}</InkNotice> : null}
      {error && !report ? (
        <View style={styles.row}>
          <InkNotice tone="danger">{error}</InkNotice>
          <InkButton variant="quiet" icon="refresh" onPress={() => void actions.retry()}>
            {t('common.retry')}
          </InkButton>
        </View>
      ) : null}

      {report ? (
        <>
          <View style={styles.head}>
            <InkEyebrow>{taskEyebrow(report.kind, '')}</InkEyebrow>
            {options.length > 0 ? (
              <InkButton variant="quiet" icon="upload" onPress={() => void share()} disabled={sharing !== null}>
                {sharing ? t('chat.report.sharing') : t('chat.report.share')}
              </InkButton>
            ) : null}
          </View>
          {shareError ? (
            <Text accessibilityRole="alert" style={danger.style}>
              {shareError}
            </Text>
          ) : null}
          {report.exportable ? null : <InkNotice tone="neutral">{t('chat.report.olderPond')}</InkNotice>}
          {report.final ? null : <InkNotice tone="neutral">{t('chat.report.notFinished')}</InkNotice>}

          {titled.length > 1 ? (
            <View style={styles.jumps}>
              <InkEyebrow>{t('chat.report.sections')}</InkEyebrow>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {report.sections.map((section, i) =>
                  section.title ? (
                    <InkChip key={i} onPress={() => jump(i)}>
                      {section.title}
                    </InkChip>
                  ) : null,
                )}
              </ScrollView>
            </View>
          ) : null}

          {report.markdown.trim() === '' ? <InkNotice tone="neutral">{t('chat.report.empty')}</InkNotice> : null}
          {report.sections.map((section, i) => (
            <View
              key={i}
              onLayout={(e) => {
                const y = e.nativeEvent.layout.y;
                setOffsets((all) => (all[i] === y ? all : { ...all, [i]: y }));
              }}
            >
              <Markdown source={section.markdown} />
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    content: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing['4xl'] },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
    row: { gap: Spacing.sm },
    jumps: { gap: Spacing.xs },
    chips: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  });
