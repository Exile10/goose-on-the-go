/**
 * HomeIdeas — what the Pond has thought of, as Home's widget: every suggestion, decided in place
 * and set as markdown, and an agent it could run. The widget grows to hold them all, and folds to
 * the first one for whoever would rather not scroll past the rest. AskRow is Ask Goose: a field that opens a conversation, and the questions it offers.
 *
 * Deciding in place is acceptable only because a yes runs nothing: the Pond records it and
 * `ProposalDecisionResult.executed` is always false. If that changes, the buttons belong back on
 * the Suggestions screen, which says what a yes does. Home raises this widget's frame while a
 * suggestion is in it, because it is the one thing on the screen that waits for an answer.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkText, inkText, useInkTheme } from '@/components/ui/ink';

import { Markdown } from '@/components/patterns/markdown';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { selectionTick, tap } from '@/services/haptics';
import type { AgentIdea } from '@/view-models/use-home-ideas';
import type { OfferedPrompt } from '@/view-models/use-suggestions';
import type { ProposalRow } from '@/view-models/use-proposals';
import { WidgetHeader } from './home-widgets';

export interface HomeIdeasProps {
  proposals: ProposalRow[];
  agent: AgentIdea | null;
  deciding: string | null;
  /** Both reads answered with nothing: said, so an empty widget is not mistaken for a failed one. */
  quiet?: boolean;
  /** Folded to the first suggestion, and a count of the rest. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
}

export function HomeIdeas({
  proposals,
  agent,
  deciding,
  quiet = false,
  collapsed = false,
  onToggleCollapsed,
  onAccept,
  onDecline,
}: HomeIdeasProps) {
  const theme = useInkTheme();
  const styles = makeStyles(theme);
  const { t } = useTranslation();

  // What a decision came to is said in the app's snackbar, which outlives the suggestion it answered.
  if (proposals.length === 0 && !agent && !quiet) return null;

  // Folded, the first thing stays whole and the rest wait behind Show all.
  const waiting = proposals.length + (agent ? 1 : 0);
  const shown = collapsed ? proposals.slice(0, 1) : proposals;
  const showAgent = !!agent && (!collapsed || proposals.length === 0);
  const hidden = waiting - shown.length - (showAgent ? 1 : 0);

  return (
    <View>
      <WidgetHeader
        icon="sparkle"
        title={t('home.ideas.title')}
        action={
          // Nothing to fold away with one thing in it.
          onToggleCollapsed && waiting > 1
            ? {
                label: t(collapsed ? 'home.ideas.show' : 'home.ideas.hide'),
                name: t(collapsed ? 'home.ideas.showName' : 'home.ideas.hideName'),
                onPress: () => {
                  void selectionTick();
                  onToggleCollapsed();
                },
              }
            : null
        }
      />

      {shown.map((p, i) => (
        <View key={p.id} style={[styles.proposal, i > 0 && styles.divided]}>
          <Markdown source={p.summary} size="title" selectable={false} />
          {p.rationale ? <Markdown source={p.rationale} size="sm" tone="secondary" selectable={false} /> : null}
          {/* Against the right edge, where the thumb is, and after the reason: a yes follows what it answers. */}
          <View style={styles.actions}>
            <InkButton variant="quiet" disabled={deciding !== null} onPress={() => onDecline(p.id)}>
              {t('proposals.card.decline')}
            </InkButton>
            <InkButton variant="primary" disabled={deciding !== null} onPress={() => onAccept(p.id)}>
              {deciding === p.id ? t('proposals.card.deciding') : t('proposals.card.accept')}
            </InkButton>
          </View>
        </View>
      ))}

      {quiet && proposals.length === 0 && !agent ? (
        <InkText size="sm" tone="secondary">
          {t('home.ideas.quiet')}
        </InkText>
      ) : null}

      {showAgent && agent ? <AgentLine agent={agent} divided={shown.length > 0} /> : null}

      {hidden > 0 ? (
        <View style={styles.more}>
          <InkText size="sm" tone="secondary">
            {t('home.ideas.moreWaiting', { count: hidden })}
          </InkText>
        </View>
      ) : null}
    </View>
  );
}

/** An agent the Pond could run. It opens the Agents screen, which explains it and turns it on. */
function AgentLine({ agent, divided }: { agent: AgentIdea; divided: boolean }) {
  const theme = useInkTheme();
  const styles = makeStyles(theme);
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <GPressable
      style={[styles.agent, divided && styles.divided]}
      accessibilityRole="button"
      accessibilityLabel={t('home.ideas.agentLabel', { title: agent.title, when: agent.when })}
      onPress={() => {
        void tap();
        router.push('/(stack)/agents');
      }}
    >
      <View style={styles.agentIcon}>
        <GIcon name="agent" size={16} color={theme.color.accentLine} />
      </View>
      <View style={styles.agentWords}>
        {/* Named as an agent: an agent's title alone, "Welcome back", reads as a greeting. */}
        <Text style={styles.agentTitle}>{t('home.ideas.agent', { title: agent.title })}</Text>
        {agent.when ? <Text style={styles.why}>{agent.when}</Text> : null}
      </View>
      <GIcon name="chevron-right" size={16} color={theme.color.textTertiary} strokeWidth={2.5} />
    </GPressable>
  );
}

export interface AskRowProps {
  prompts: OfferedPrompt[];
  onAsk: (prompt: OfferedPrompt) => void;
  onAskGoose: () => void;
}

/**
 * Ask Goose: a field to tap, which opens a conversation, then what a new chat would offer to ask,
 * whole, as rows under "Try asking". With none offered, the field stands alone.
 */
export function AskRow({ prompts, onAsk, onAskGoose }: AskRowProps) {
  const theme = useInkTheme();
  const styles = makeStyles(theme);
  const { t } = useTranslation();

  return (
    <View>
      <WidgetHeader icon="chat" title={t('pond.askGoose')} />

      <GPressable
        style={styles.field}
        accessibilityRole="button"
        accessibilityLabel={t('pond.askGoose')}
        accessibilityHint={t('home.ask.openHint')}
        onPress={onAskGoose}
      >
        <Text style={styles.fieldText} numberOfLines={1}>
          {t('home.askPlaceholder')}
        </Text>
        <View style={styles.fieldAction}>
          <GIcon name="compose" size={16} color={theme.color.textOnAccent} strokeWidth={2.5} />
        </View>
      </GPressable>

      {prompts.length > 0 ? (
        <>
          <Text style={styles.tryLabel}>{t('home.ask.tryAsking')}</Text>
          {prompts.map((prompt, i) => (
            <GPressable
              key={prompt.id ?? prompt.prompt}
              style={[styles.suggestion, i > 0 && styles.hairline]}
              accessibilityRole="button"
              accessibilityLabel={prompt.prompt}
              accessibilityHint={t('home.ask.suggestionHint')}
              onPress={() => onAsk(prompt)}
            >
              <GIcon name="prompts" size={16} color={theme.color.accentLine} />
              <Text style={styles.suggestionText}>{prompt.prompt}</Text>
              <GIcon name="chevron-right" size={16} color={theme.color.textTertiary} strokeWidth={2.5} />
            </GPressable>
          ))}
        </>
      ) : null}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useInkTheme>) =>
  StyleSheet.create({
    proposal: { gap: theme.space[1] },
    divided: { borderTopWidth: theme.edge.hairlineWidth, borderTopColor: theme.color.line, marginTop: theme.space[3], paddingTop: theme.space[3] },
    why: inkText(theme, { size: 'sm', color: theme.color.textSecondary }).style,
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.space[2], marginTop: theme.space[3] },
    more: { marginTop: theme.space[3] },
    agent: { flexDirection: 'row', alignItems: 'center', gap: theme.space[3] },
    agentIcon: {
      width: 32,
      height: 32,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    agentWords: { flex: 1, gap: 1 },
    agentTitle: inkText(theme, { size: 'md', weight: theme.weight.semibold }).style,
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space[2],
      minHeight: theme.rowHeight.md,
      paddingLeft: theme.space[4],
      paddingRight: theme.space[1] + 2,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.color.chrome,
    },
    fieldText: { ...inkText(theme, { size: 'md', color: theme.color.textSecondary }).style, flex: 1 },
    fieldAction: {
      width: 32,
      height: 32,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.color.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tryLabel: {
      ...inkText(theme, { size: 'sm', weight: theme.weight.semibold, color: theme.color.textTertiary }).style,
      marginTop: theme.space[4],
      marginBottom: theme.space[1],
    },
    suggestion: { flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: theme.rowHeight.md },
    hairline: { borderTopWidth: theme.edge.hairlineWidth, borderTopColor: theme.color.line },
    suggestionText: { ...inkText(theme, { size: 'md' }).style, flex: 1, paddingVertical: theme.space[2] },
  });
