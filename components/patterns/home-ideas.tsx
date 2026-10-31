/**
 * HomeIdeas — the Pond's own ideas, on Home: proposals awaiting a yes or no, prompts worth
 * asking, and a line for reminders still pending.
 *
 * All three were already composed by the Pond and reachable only from the You tab. Home is the
 * glance; `/(stack)/suggestions` and `/(stack)/reminders` stay the record, and See all leads
 * there once there is more than fits.
 *
 * Accepting records a yes and runs nothing -- `ProposalDecisionResult.executed` is always false --
 * which is what makes deciding in place here acceptable rather than a button that acts unseen.
 *
 * Reminders are a line and never a card with a dismiss: dismissal is final, the Pond has no route
 * that brings one back, and the asking belongs on the screen that already asks.
 *
 * Draws nothing at all when the Pond has offered nothing, which is the rest of Home's rule.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkChip, InkText, InkTitle } from '@jarida/ink/native';

import { GPressable } from '@/components/ui/g-pressable';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { selectionTick } from '@/services/haptics';
import { useHomeIdeas, type PondPrompt } from '@/view-models/use-home-ideas';

export function HomeIdeas() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { data, deciding, empty, actions } = useHomeIdeas();

  if (empty) return null;

  const more = data.proposalCount - data.proposals.length;

  const ask = (prompt: PondPrompt) => {
    void selectionTick();
    actions.taken(prompt);
    router.push({ pathname: '/conversation', params: { ask: prompt.prompt } });
  };

  return (
    <>
      <View style={styles.header}>
        <InkTitle level={3}>
          {data.proposals.length > 0 ? t('home.ideasTitle') : t('home.ideasAsk')}
        </InkTitle>
        {more > 0 ? (
          <GPressable onPress={() => router.push('/(stack)/suggestions')}>
            <InkText size="sm" tone="secondary">{t('home.ideasSeeAll', { count: more })}</InkText>
          </GPressable>
        ) : null}
      </View>

      {data.proposals.map((row) => (
        <InkCard key={row.id} style={styles.card}>
          <InkText weight="semibold">{row.summary}</InkText>
          <InkText size="sm" tone="secondary">{t('proposals.card.why', { rationale: row.rationale })}</InkText>
          <View style={styles.actions}>
            <InkButton
              variant="quiet"
              icon="x"
              disabled={deciding !== null}
              onPress={() => void actions.decline(row.id)}
            >
              {t('proposals.card.decline')}
            </InkButton>
            <InkButton
              variant="primary"
              icon="check"
              loading={deciding === row.id}
              disabled={deciding !== null}
              onPress={() => void actions.approve(row.id)}
            >
              {t('proposals.card.accept')}
            </InkButton>
          </View>
        </InkCard>
      ))}

      {data.prompts.length > 0 ? (
        <View style={styles.chips}>
          {data.prompts.map((prompt) => (
            <InkChip key={prompt.id} onPress={() => ask(prompt)}>
              {prompt.prompt}
            </InkChip>
          ))}
        </View>
      ) : null}

      {data.reminderCount > 0 ? (
        <GPressable style={styles.reminders} onPress={() => router.push('/(stack)/reminders')}>
          <InkText size="sm" tone="secondary">
            {t('home.remindersWaiting', { count: data.reminderCount })}
          </InkText>
        </GPressable>
      ) : null}
    </>
  );
}

const makeStyles = (_c: ThemeColors) =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    // InkCard draws its own face and plate; this carries layout only.
    card: { gap: Spacing.sm },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    reminders: { paddingVertical: Spacing.xs },
  });
