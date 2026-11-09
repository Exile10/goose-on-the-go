/**
 * For a Pond without `/me/hub`, unchanged from before the hub.
 *
 * Ideas — what the Goose thought of while it was quiet: questions worth asking, each with why it
 * is offered, and agents it could run for this household. A question opens a chat that asks it.
 */

import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkEmptyState, InkText, InkTitle, useInkTheme } from '@jarida/ink/native';

import { GlyphRow } from '@/components/patterns/goose-shelves';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { selectionTick } from '@/services/haptics';
import { useAgentIdeas } from '@/view-models/use-my-goose';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { useReminders } from '@/view-models/use-reminders';
import { useSuggestions, type OfferedPrompt } from '@/view-models/use-suggestions';

function Question({ prompt, onAsk }: { prompt: OfferedPrompt; onAsk: () => void }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  return (
    <GPressable
      feedback="lift"
      onPress={onAsk}
      accessibilityRole="button"
      accessibilityLabel={t('myGoose.ideas.askLabel', { prompt: prompt.prompt })}
    >
      <InkCard>
        <View style={styles.question}>
          <View style={styles.words}>
            <InkText size="md" weight="semibold">
              {prompt.prompt}
            </InkText>
            {prompt.because ? (
              <InkText size="sm" tone="secondary">
                {prompt.because}
              </InkText>
            ) : null}
          </View>
          <GIcon name="send" size={18} color={theme.color.accentLine} />
        </View>
      </InkCard>
    </GPressable>
  );
}

export function OlderIdeas() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const suggestions = useSuggestions(null);
  const agents = useAgentIdeas();
  const reminders = useReminders();
  const pull = usePullToRefresh(async () => {
    await Promise.all([agents.refresh(), reminders.actions.refresh()]);
  });
  const prompts = suggestions.data.prompts.filter((p) => p.id !== null);

  const ask = (prompt: OfferedPrompt) => {
    void selectionTick();
    suggestions.actions.taken(prompt);
    router.push({ pathname: '/conversation', params: { ask: prompt.prompt } } as never);
  };

  const nothing = prompts.length === 0 && agents.ideas.length === 0 && reminders.data.rows.length === 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl {...pull} />}
    >
      {nothing ? (
        <InkEmptyState icon="sparkle" title={t('myGoose.ideas.emptyTitle')}>
          <InkText tone="secondary">{t('myGoose.ideas.emptyBody')}</InkText>
        </InkEmptyState>
      ) : (
        <InkText size="sm" tone="secondary">
          {t('myGoose.ideas.intro')}
        </InkText>
      )}

      {prompts.length > 0 ? (
        <View style={styles.group}>
          <InkTitle level={3}>{t('myGoose.ideas.ask')}</InkTitle>
          {prompts.map((p) => (
            <Question key={p.id ?? p.prompt} prompt={p} onAsk={() => ask(p)} />
          ))}
        </View>
      ) : null}

      {agents.ideas.length > 0 ? (
        <View style={styles.group}>
          <InkTitle level={3}>{t('myGoose.ideas.agents')}</InkTitle>
          {agents.ideas.map((idea) => (
            <InkCard key={idea.template}>
              <View style={styles.agent}>
                <InkText size="md" weight="semibold">
                  {idea.title}
                </InkText>
                {idea.activations_summary ? (
                  <InkText size="xs" tone="tertiary">
                    {idea.activations_summary}
                  </InkText>
                ) : null}
                <InkText size="sm" tone="secondary">
                  {idea.why || idea.description}
                </InkText>
                <View style={styles.answers}>
                  <InkButton
                    variant="primary"
                    size="sm"
                    onPress={() => void agents.enable(idea.template)}
                    loading={agents.enabling === idea.template}
                  >
                    {t('myGoose.ideas.setUp')}
                  </InkButton>
                  <InkButton
                    size="sm"
                    variant="quiet"
                    onPress={() => void agents.dismiss(idea.template)}
                    disabled={agents.enabling === idea.template}
                  >
                    {t('myGoose.ideas.notForMe')}
                  </InkButton>
                </View>
              </View>
            </InkCard>
          ))}
        </View>
      ) : null}

      {reminders.data.rows.length > 0 ? (
        <GlyphRow
          icon="alarm"
          title={t('myGoose.ideas.reminders', { count: reminders.data.rows.length })}
          detail={reminders.data.rows[0].text}
          onPress={() => {
            void selectionTick();
            router.push('/(stack)/reminders' as never);
          }}
        />
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.lg, gap: Spacing.xl, paddingBottom: Spacing['4xl'] },
    group: { gap: Spacing.md },
    question: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    words: { flex: 1, gap: Spacing.xs },
    agent: { gap: Spacing.xs },
    answers: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  });
