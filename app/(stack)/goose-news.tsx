/**
 * News — what the Pond's scheduled questions wrote, newest first: the morning news a member asked
 * for once. A household with none is offered one, at 7:00 every day, in a single press.
 */

import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkAccordion, InkButton, InkEmptyState, InkNotice, InkSpinner, InkText, InkTitle } from '@jarida/ink/native';

import { Markdown } from '@/components/patterns/markdown';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { Brief } from '@/models/my-goose';
import { formatScheduleTime } from '@/models/schedule';
import { confirm } from '@/services/haptics';
import { useBriefs } from '@/view-models/use-briefs';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

function BriefSection({ brief, onRunNow }: { brief: Brief; onRunNow: () => void }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const [asked, setAsked] = useState(false);
  return (
    <View style={styles.brief}>
      <View style={styles.briefHead}>
        <InkTitle level={2}>{brief.name}</InkTitle>
        <InkText size="xs" tone="tertiary">{t('myGoose.news.written', { when: formatScheduleTime(brief.at) })}</InkText>
      </View>
      <Markdown source={brief.text} />
      {asked ? (
        <InkNotice tone="info">{t('myGoose.news.asked')}</InkNotice>
      ) : (
        <View style={styles.actions}>
          <InkButton
            size="sm"
            variant="quiet"
            icon="refresh"
            onPress={() => {
              setAsked(true);
              onRunNow();
            }}
          >
            {t('myGoose.news.runNow')}
          </InkButton>
        </View>
      )}
      {brief.earlier.length > 0 ? (
        <InkAccordion
          label={t('myGoose.news.earlier')}
          items={brief.earlier.map((run) => ({
            key: run.id,
            title: formatScheduleTime(run.at),
            content: <Markdown source={run.text} size="sm" tone="secondary" />,
          }))}
        />
      ) : null}
      <InkText size="xs" tone="tertiary" numberOfLines={2}>{t('myGoose.news.asksFor', { prompt: brief.prompt })}</InkText>
    </View>
  );
}

export default function GooseNewsScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const { data, loading, error, starting, actions } = useBriefs();
  const pull = usePullToRefresh(actions.refresh);
  const [started, setStarted] = useState(false);

  const start = async () => {
    if (await actions.startMorningNews()) {
      void confirm();
      setStarted(true);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl {...pull} />}
    >
      {loading && data.briefs.length === 0 ? <InkSpinner label={t('myGoose.loading')} /> : null}
      {error ? <InkNotice tone="danger">{error}</InkNotice> : null}
      {started ? <InkNotice tone="success">{t('myGoose.news.started')}</InkNotice> : null}
      {!loading && data.briefs.length === 0 && data.asking > 0 && !started ? (
        <InkNotice tone="info">{t('myGoose.news.waiting')}</InkNotice>
      ) : null}
      {!loading && !error && data.briefs.length === 0 && data.asking === 0 ? (
        <InkEmptyState
          icon="file-text"
          title={t('myGoose.news.emptyTitle')}
          action={
            <InkButton variant="primary" onPress={() => void start()} loading={starting}>
              {t('myGoose.news.start')}
            </InkButton>
          }
        >
          <InkText tone="secondary">{t('myGoose.news.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}
      {data.briefs.map((brief) => (
        <BriefSection key={brief.scheduleId} brief={brief} onRunNow={() => void actions.runNow(brief.scheduleId)} />
      ))}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.lg, gap: Spacing['2xl'], paddingBottom: Spacing['4xl'] },
    brief: { gap: Spacing.md },
    briefHead: { gap: 2 },
    actions: { flexDirection: 'row' },
  });
