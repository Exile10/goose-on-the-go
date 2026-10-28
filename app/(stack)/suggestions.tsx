/**
 * SuggestionsScreen — what the Pond noticed and offers to do, each with its
 * reason, and Accept or Decline.
 *
 * Accepting records a yes and runs nothing; the screen says so, because the
 * word "accept" invites the other reading.
 */

import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkEmptyState, InkNotice, InkSpinner, InkText } from '@jarida/ink/native';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { useProposals } from '@/view-models/use-proposals';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

export default function SuggestionsScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const { data, loading, error, failed, deciding, outcome, actions } = useProposals();
  // A refused refresh with the list still on screen is said above it; a list that never arrived is
  // said once, in its place.
  const state = useContentState({ loading, failed: failed || error !== null, hasContent: data.rows.length > 0 });
  const pull = usePullToRefresh(actions.refresh);
  const unavailable = isUnavailable(state);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl {...pull} />}
    >
      <InkText size="sm" tone="secondary">{t('proposals.intro')}</InkText>

      {loading ? <InkSpinner label={t('proposals.list.loading')} /> : null}

      {outcome ? <InkNotice tone={outcome.tone}>{outcome.text}</InkNotice> : null}

      {unavailable ? (
        <ContentUnavailable state={state} reason={error} onRetry={actions.refresh} />
      ) : error ? (
        <InkNotice tone="danger">{error}</InkNotice>
      ) : null}

      {state === 'empty' ? (
        <InkEmptyState icon="light" title={t('proposals.list.emptyTitle')}>
          <InkText>{t('proposals.list.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}

      {data.rows.map((row) => (
        <InkCard key={row.id}>
          <View style={styles.body}>
            <InkText weight="semibold">{row.summary}</InkText>
            <InkText size="sm" tone="secondary">{t('proposals.card.why', { rationale: row.rationale })}</InkText>
            {row.expires ? (
              <InkText size="sm" tone="tertiary">{t('proposals.card.expires', { when: row.expires })}</InkText>
            ) : null}
            <View style={styles.actions}>
              <InkButton
                variant="quiet"
                icon="x"
                disabled={deciding !== null}
                onPress={() => void actions.decide(row.id, 'reject')}
              >
                {t('proposals.card.decline')}
              </InkButton>
              <InkButton
                variant="primary"
                icon="check"
                disabled={deciding !== null}
                onPress={() => void actions.decide(row.id, 'approve')}
              >
                {deciding === row.id ? t('proposals.card.deciding') : t('proposals.card.accept')}
              </InkButton>
            </View>
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
    body: { gap: Spacing.sm },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
  });
