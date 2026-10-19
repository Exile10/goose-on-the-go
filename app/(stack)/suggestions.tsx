/**
 * SuggestionsScreen — what the Pond noticed and offers to do, each with its
 * reason, and Accept or Decline.
 *
 * Accepting records a yes and runs nothing; the screen says so, because the
 * word "accept" invites the other reading.
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkEmptyState, InkNotice, InkSpinner, InkText } from '@jarida/ink/native';

import { useProposals } from '@/view-models/use-proposals';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

export default function SuggestionsScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const { data, loading, error, failed, deciding, outcome, actions } = useProposals();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <InkText size="sm" tone="secondary">{t('proposals.intro')}</InkText>

      {loading ? <InkSpinner label={t('proposals.list.loading')} /> : null}

      {outcome ? <InkNotice tone={outcome.tone}>{outcome.text}</InkNotice> : null}

      {/* A failed read with no sentence of its own still leaves the list unknown. */}
      {error || failed ? (
        <View style={styles.notice}>
          <InkNotice tone="danger">{error ?? t('proposals.list.failed')}</InkNotice>
          <InkButton variant="quiet" icon="refresh" onPress={actions.refresh}>
            {t('common.retry')}
          </InkButton>
        </View>
      ) : null}

      {!loading && !error && !failed && data.rows.length === 0 ? (
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
    notice: { gap: Spacing.sm },
    body: { gap: Spacing.sm },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
  });
