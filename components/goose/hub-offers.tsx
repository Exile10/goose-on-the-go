/**
 * Reminders, on a Pond that serves the hub: the dated things the Pond picked out of chats, each
 * offered as a to-do. Add keeps it, at the time the Pond worked out or one the member picks; No
 * lets it go.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkCard, InkEmptyState, InkSpinner, InkText, useInkTheme } from '@/components/ui/ink';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { Spacing } from '@/constants/spacing';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { useTodos } from '@/view-models/use-todos';
import { MoreLink, ScreenScroll, SectionHead } from './hub-parts';
import { OfferRow } from './todo-parts';

export function HubOffers() {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const todos = useTodos();
  const pull = usePullToRefresh(todos.actions.reload);
  const [busy, setBusy] = useState<string | null>(null);
  const { offers } = todos.data;
  const state = useContentState({ loading: todos.loading, failed: todos.failed, hasContent: offers.length > 0 });
  return (
    <ScreenScroll pull={pull}>
      <SectionHead title={t('goose.offers.title')} subtitle={t('goose.offers.subtitle')} />
      {state === 'loading' ? <InkSpinner label={t('goose.todos.loading')} /> : null}
      {isUnavailable(state) ? <ContentUnavailable state={state} reason={todos.error} onRetry={todos.actions.reload} /> : null}
      {state === 'empty' ? (
        <InkEmptyState icon="chat" title={t('goose.offers.emptyTitle')}>
          <InkText tone="secondary">{t('goose.offers.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}
      {offers.length ? (
        <InkCard contentStyle={styles.card}>
          {offers.map((offer, i) => (
            <View key={offer.reminderId} style={i > 0 ? [styles.divided, { borderTopColor: theme.color.line }] : null}>
              <OfferRow
                offer={offer}
                busy={busy === offer.reminderId}
                onAdd={async (dueAt) => {
                  setBusy(offer.reminderId);
                  await todos.actions.acceptOffer(offer, dueAt);
                  setBusy(null);
                }}
                onNo={async () => {
                  setBusy(offer.reminderId);
                  await todos.actions.declineOffer(offer);
                  setBusy(null);
                }}
              />
            </View>
          ))}
        </InkCard>
      ) : null}
      <MoreLink label={t('goose.offers.toTodos')} onPress={() => router.push('/(stack)/goose-todos')} />
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: Spacing.xs, gap: 0 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth },
});
