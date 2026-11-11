/**
 * For a Pond without `/me/hub`, unchanged from before the hub.
 *
 * RemindersScreen — the dated things the Pond picked out of conversations,
 * each with the words that said when, and a way to dismiss one.
 *
 * Dismissal cannot be undone from anywhere, so it is confirmed first.
 */

import React, { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkEmptyState, InkNotice, InkSpinner, InkText } from '@/components/ui/ink';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { useConfirm } from '@/providers/confirm-provider';
import { useReminders, type ReminderRow } from '@/view-models/use-reminders';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

export function OlderReminders() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const confirm = useConfirm();
  const { data, loading, error, failed, dismissing, actions } = useReminders();
  // A refused refresh with the list still on screen is said above it; a list that never arrived is
  // said once, in its place.
  const state = useContentState({ loading, failed: failed || error !== null, hasContent: data.rows.length > 0 });
  const pull = usePullToRefresh(actions.refresh);
  const unavailable = isUnavailable(state);

  const { dismiss } = actions;
  const confirmDismiss = useCallback(
    async (row: ReminderRow) => {
      const yes = await confirm({
        title: t('reminders.dismissTitle'),
        message: t('reminders.dismissBody'),
        confirmLabel: t('reminders.card.dismiss'),
        destructive: true,
      });
      if (yes) void dismiss(row.id);
    },
    [confirm, t, dismiss],
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl {...pull} />}
    >
      <InkText size="sm" tone="secondary">{t('reminders.intro')}</InkText>

      {loading ? <InkSpinner label={t('reminders.list.loading')} /> : null}

      {unavailable ? (
        <ContentUnavailable state={state} reason={error} onRetry={actions.refresh} />
      ) : error ? (
        <InkNotice tone="danger">{error}</InkNotice>
      ) : null}

      {state === 'empty' ? (
        <InkEmptyState icon="calendar" title={t('reminders.list.emptyTitle')}>
          <InkText>{t('reminders.list.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}

      {data.rows.map((row) => (
        <InkCard key={row.id}>
          <InkText weight="semibold">{row.due ?? t('reminders.card.noDue')}</InkText>
          <InkText>{row.text}</InkText>
          <View style={styles.footer}>
            <InkText size="sm" tone="tertiary">{t('reminders.card.said', { when: row.said })}</InkText>
            <InkButton
              variant="quiet"
              icon="check"
              disabled={dismissing !== null}
              onPress={() => confirmDismiss(row)}
            >
              {dismissing === row.id ? t('reminders.card.dismissing') : t('reminders.card.dismiss')}
            </InkButton>
          </View>
        </InkCard>
      ))}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing['4xl'] },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  });
