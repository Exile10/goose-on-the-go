/**
 * HomeIdeas — what the Pond has thought of, on Home: its suggestions, decided in place, and an
 * agent it could run. AskRow is the questions it offers, with Ask Goose always last.
 *
 * Deciding in place is acceptable only because a yes runs nothing: the Pond records it and
 * `ProposalDecisionResult.executed` is always false. If that changes, the buttons belong back on
 * the Suggestions screen, which says what a yes does. The suggestion cards are the one raised
 * surface on Home, because they are the one thing on it that waits for an answer.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkChip, InkEdge, InkText, InkTitle, inkText, useInkTheme } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { selectionTick, tap } from '@/services/haptics';
import type { AgentIdea, PondPrompt, UseHomeIdeas } from '@/view-models/use-home-ideas';
import type { ProposalRow } from '@/view-models/use-proposals';

export interface HomeIdeasProps {
  proposals: ProposalRow[];
  moreProposals: number;
  agent: AgentIdea | null;
  deciding: string | null;
  outcome: UseHomeIdeas['outcome'];
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
}

export function HomeIdeas({ proposals, moreProposals, agent, deciding, outcome, onAccept, onDecline }: HomeIdeasProps) {
  const theme = useInkTheme();
  const styles = makeStyles(theme);
  const { t } = useTranslation();
  const router = useRouter();

  // The outcome outlives its card by a few seconds, so a last decision still says what it did.
  if (proposals.length === 0 && !agent && !outcome) return null;

  return (
    <View style={styles.block}>
      <View style={styles.header}>
        <InkTitle level={3}>{t('home.ideas.title')}</InkTitle>
        {moreProposals > 0 ? (
          <GPressable
            hitSlop={12}
            accessibilityRole="button"
            onPress={() => {
              void selectionTick();
              router.push('/(stack)/suggestions');
            }}
          >
            <Text style={styles.link}>{t('home.ideas.more', { count: moreProposals })}</Text>
          </GPressable>
        ) : null}
      </View>

      {proposals.map((p) => (
        <InkCard key={p.id}>
          <Text style={styles.summary}>{p.summary}</Text>
          {p.rationale ? <Text style={styles.why}>{p.rationale}</Text> : null}
          {/* Against the right edge, where the thumb is, and after the reason: a yes follows what it answers. */}
          <View style={styles.actions}>
            <InkButton variant="quiet" disabled={deciding !== null} onPress={() => onDecline(p.id)}>
              {t('proposals.card.decline')}
            </InkButton>
            <InkButton variant="primary" disabled={deciding !== null} onPress={() => onAccept(p.id)}>
              {deciding === p.id ? t('proposals.card.deciding') : t('proposals.card.accept')}
            </InkButton>
          </View>
        </InkCard>
      ))}

      {outcome ? (
        <View accessibilityLiveRegion="polite">
          <InkText size="sm" tone="secondary">
            {outcome.text}
          </InkText>
        </View>
      ) : null}

      {agent ? <AgentLine agent={agent} /> : null}
    </View>
  );
}

/** An agent the Pond could run. It opens the Agents screen, which explains it and turns it on. */
function AgentLine({ agent }: { agent: AgentIdea }) {
  const theme = useInkTheme();
  const styles = makeStyles(theme);
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <GPressable
      accessibilityRole="button"
      accessibilityLabel={t('home.ideas.agentLabel', { title: agent.title, when: agent.when })}
      onPress={() => {
        void tap();
        router.push('/(stack)/agents');
      }}
    >
      <InkEdge raised={false} radius={theme.radius.lg} contentStyle={styles.agent}>
        <GIcon name="agent" size={18} color={theme.color.accentLine} />
        <View style={styles.agentWords}>
          {/* Named as an agent: an agent's title alone, "Welcome back", reads as a greeting. */}
          <Text style={styles.agentTitle} numberOfLines={1}>
            {t('home.ideas.agent', { title: agent.title })}
          </Text>
          {agent.when ? (
            <Text style={styles.why} numberOfLines={1}>
              {agent.when}
            </Text>
          ) : null}
        </View>
        <GIcon name="chevron-right" size={16} color={theme.color.textTertiary} strokeWidth={2.5} />
      </InkEdge>
    </GPressable>
  );
}

export interface AskRowProps {
  prompts: PondPrompt[];
  onAsk: (prompt: PondPrompt) => void;
  onAskGoose: () => void;
}

/**
 * The Pond's questions, then Ask Goose. No heading: a row of questions says what it is, and with
 * none offered a heading would stand over one chip. Never empty, so never a gap.
 */
export function AskRow({ prompts, onAsk, onAskGoose }: AskRowProps) {
  const theme = useInkTheme();
  const styles = makeStyles(theme);
  const { t } = useTranslation();

  return (
    <View style={[styles.block, styles.chips]}>
      {prompts.map((prompt) => (
        <InkChip key={prompt.id} onPress={() => onAsk(prompt)}>
          {prompt.prompt}
        </InkChip>
      ))}
      <InkChip icon="chat" onPress={onAskGoose}>
        {t('pond.askGoose')}
      </InkChip>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useInkTheme>) =>
  StyleSheet.create({
    block: { gap: theme.space[2], marginBottom: theme.space[5] },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3] },
    link: inkText(theme, { size: 'sm', weight: theme.weight.semibold, color: theme.color.accentLine }).style,
    summary: inkText(theme, { role: 'display', size: 'md', weight: theme.weight.bold, tracking: 'snug', leading: 'snug' }).style,
    why: inkText(theme, { size: 'sm', color: theme.color.textSecondary }).style,
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.space[2], marginTop: theme.space[1] },
    agent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space[3],
      minHeight: theme.rowHeight.lg,
      paddingHorizontal: theme.space[4],
      paddingVertical: theme.space[2],
    },
    agentWords: { flex: 1, gap: 1 },
    agentTitle: inkText(theme, { size: 'base', weight: theme.weight.semibold }).style,
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] },
  });
