/**
 * An idea Goose researched: its picture, what it is, why it is for this member, and the two ways to
 * act on it. "Goose, do it" hands Goose its part and shows it working; "I'll do it" turns the steps
 * into the member's to-dos and lists them where the buttons were.
 */

import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkSpinner, InkText, useInkTheme } from '@/components/ui/ink';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { IconName } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { ideaKindKey, type GooseCanKind, type Idea, type IdeaKind } from '@/models/ideas';
import { inSentence } from '@/models/me-read';
import type { Todo } from '@/models/todos';
import { GroupRow } from './following';
import { HubPicture } from './hub-picture';
import { PORTRAIT_WIDTH } from './featured';

/** The glyph for what sort of thing an idea is. */
export function ideaIcon(kind: IdeaKind): IconName {
  switch (kind) {
    case 'outing':
      return 'pin';
    case 'activity':
      return 'sparkle';
    case 'date':
      return 'users';
    case 'solo_date':
      return 'profile';
    case 'trip':
      return 'globe';
    case 'recipe':
      return 'checklist';
    case 'project':
      return 'target';
    case 'interest':
      return 'light';
  }
}

/** The idea as a short row: what kind it is, its title and its one line. Tapping opens its page. */
export function IdeaRow({ idea, first, onOpen }: { idea: Idea; first?: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const kind = idea.kindLabel || t(ideaKindKey(idea.kind));
  const state = idea.state === 'working' ? t('goose.ideas.working') : idea.state === 'done' ? t('goose.ideas.done') : null;
  return <GroupRow first={first} icon={ideaIcon(idea.kind)} label={idea.title} detail={[state ?? kind, idea.hook].filter(Boolean).join('. ')} onPress={onOpen} />;
}

function gooseIcon(kind: GooseCanKind): IconName {
  switch (kind) {
    case 'research':
      return 'search';
    case 'watch':
      return 'eye';
    case 'todo':
      return 'checklist';
    case 'schedule':
      return 'calendar-clock';
    case 'chat':
      return 'chat';
  }
}

function IdeaActions({ idea, busy, made, onGoose, onMine, onChat, compact }: { idea: Idea; busy: boolean; made: Todo[] | undefined; onGoose: () => void; onMine: () => void; onChat?: () => void; compact?: boolean }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  if (idea.state === 'working') {
    return (
      <View style={[styles.state, { backgroundColor: theme.color.accentSofter }]}>
        <InkSpinner size={14} label={t('goose.ideas.working')} />
        <InkText size="sm" weight="semibold" numberOfLines={2} style={{ flex: 1 }}>
          {idea.gooseCan ? t('goose.ideas.workingOn', { what: inSentence(idea.gooseCan.label) }) : t('goose.ideas.working')}
        </InkText>
      </View>
    );
  }
  if (idea.state === 'done') {
    return (
      <View style={styles.made}>
        <View style={styles.doneLine}>
          <GIcon name="done" size={16} color={theme.color.successFg} />
          <InkText size="sm" weight="semibold" style={{ color: theme.color.successFg }}>
            {made?.length ? t('goose.ideas.yourSteps') : t('goose.ideas.done')}
          </InkText>
        </View>
        {(made ?? []).slice(0, compact ? 2 : 6).map((todo) => (
          <View key={todo.id} style={styles.doneLine}>
            <GIcon name="circle" size={14} color={theme.color.textTertiary} />
            <InkText size="sm" numberOfLines={1} style={{ flex: 1 }}>
              {todo.text}
            </InkText>
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={styles.actions}>
      {idea.gooseCan ? (
        <InkButton size="sm" variant="primary" icon={gooseIcon(idea.gooseCan.kind)} loading={busy} onPress={onGoose}>
          {t('goose.ideas.gooseDoIt')}
        </InkButton>
      ) : null}
      {idea.youCan.length ? (
        <InkButton size="sm" variant="quiet" disabled={busy} onPress={onMine}>
          {t('goose.ideas.illDoIt')}
        </InkButton>
      ) : null}
      {onChat ? (
        <InkButton size="sm" variant="quiet" icon="chat" disabled={busy} onPress={onChat}>
          {t('goose.cards.sendToChat')}
        </InkButton>
      ) : null}
    </View>
  );
}

/** An idea in My Goose's carousel: a portrait card that can still be acted on. */
export function IdeaPortrait({ idea, busy, made, onGoose, onMine, onOpen }: { idea: Idea; busy: boolean; made: Todo[] | undefined; onGoose: () => void; onMine: () => void; onOpen: () => void }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  return (
    <View style={{ width: PORTRAIT_WIDTH }}>
      <InkCard contentStyle={styles.flush}>
        <GPressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={idea.title}>
          <View style={[styles.band, { backgroundColor: theme.color.brandSoft, borderBottomColor: theme.color.line }]}>
            <InkText size="sm" weight="semibold" numberOfLines={1} style={{ flex: 1, color: theme.color.accentLine }}>
              {idea.gooseCan ? t('goose.ideas.gooseCan', { what: inSentence(idea.gooseCan.label) }) : t('goose.ideas.forYou')}
            </InkText>
            <GIcon name={idea.gooseCan ? gooseIcon(idea.gooseCan.kind) : 'light'} size={16} color={theme.color.accentLine} />
          </View>
          <HubPicture path={idea.picture} label={idea.title} style={styles.portraitPicture} icon="light" iconSize={34} />
          <View style={styles.portraitWords}>
            <InkText size="md" weight="bold" numberOfLines={2}>
              {idea.title}
            </InkText>
            <InkText size="sm" tone="secondary" numberOfLines={3}>
              {idea.why || idea.pitch}
            </InkText>
          </View>
        </GPressable>
        <View style={styles.portraitFoot}>
          <IdeaActions idea={idea} busy={busy} made={made} onGoose={onGoose} onMine={onMine} compact />
        </View>
      </InkCard>
    </View>
  );
}

/** An idea in full, on the Ideas screen. */
export function IdeaPanel({ idea, busy, made, onGoose, onMine, onDismiss, onChat }: { idea: Idea; busy: boolean; made: Todo[] | undefined; onGoose: () => void; onMine: () => void; onDismiss: () => void; onChat?: () => void }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  return (
    <InkCard contentStyle={styles.flush}>
      <HubPicture path={idea.picture} label={idea.title} style={styles.panelPicture} icon="light" iconSize={40} />
      <View style={styles.panelWords}>
        <View style={styles.doneLine}>
          <GIcon name={ideaIcon(idea.kind)} size={14} color={theme.color.accentLine} />
          <InkText size="sm" weight="semibold" style={{ color: theme.color.accentLine }}>
            {idea.kindLabel || t(ideaKindKey(idea.kind))}
          </InkText>
        </View>
        <InkText size="xl" weight="bold">
          {idea.title}
        </InkText>
        <InkText size="md">{idea.pitch}</InkText>
        {idea.facts.length ? (
          <View style={[styles.facts, { borderColor: theme.color.line }]} accessibilityLabel={t('goose.ideas.atAGlance')}>
            {idea.facts.map((fact, i) => (
              <View key={fact.label} style={[styles.fact, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.line } : null]}>
                <InkText size="sm" weight="semibold" tone="secondary" style={styles.factLabel}>
                  {fact.label}
                </InkText>
                <InkText size="md" style={{ flex: 1 }}>
                  {fact.value}
                </InkText>
              </View>
            ))}
          </View>
        ) : null}
        {idea.why ? (
          <View style={[styles.why, { borderLeftColor: theme.color.accentLine }]}>
            <InkText size="sm" weight="semibold" tone="secondary">
              {t('goose.ideas.why')}
            </InkText>
            <InkText size="md">{idea.why}</InkText>
          </View>
        ) : null}
        {idea.youCan.length && idea.state === 'new' ? (
          <View style={styles.steps}>
            <InkText size="sm" weight="semibold" tone="secondary">
              {t('goose.ideas.steps')}
            </InkText>
            {idea.youCan.map((step, i) => (
              <View key={i} style={styles.doneLine}>
                <GIcon name="circle" size={14} color={theme.color.textTertiary} />
                <InkText size="md" style={{ flex: 1 }}>
                  {step}
                </InkText>
              </View>
            ))}
          </View>
        ) : null}
        {idea.groundedIn.some((g) => g.kind === 'screenshot') ? (
          <View style={styles.doneLine}>
            <GIcon name="photo" size={14} color={theme.color.textTertiary} />
            <InkText size="sm" tone="secondary" style={{ flex: 1 }}>
              {t('goose.ideas.fromScreenshot')}
            </InkText>
          </View>
        ) : null}
        {idea.notes ? (
          <View style={styles.steps}>
            <InkText size="sm" weight="semibold" tone="secondary">
              {t('goose.ideas.gooseNotes')}
            </InkText>
            <InkText size="sm" tone="secondary">
              {t('goose.ideas.gooseNotesHint')}
            </InkText>
            <InkText size="md">{idea.notes}</InkText>
          </View>
        ) : null}
        {idea.sources.length ? (
          <View style={styles.sources}>
            <InkText size="sm" weight="semibold" tone="secondary">
              {t('goose.ideas.sources')}
            </InkText>
            {idea.sources.map((s) => (
              <GPressable key={s.url} onPress={() => void Linking.openURL(s.url)} accessibilityRole="link" accessibilityLabel={t('goose.story.openSource', { site: s.site })} style={styles.source}>
                <GIcon name="external" size={14} color={theme.color.accentLine} />
                <InkText size="sm" weight="semibold" numberOfLines={1} style={{ color: theme.color.accentLine, flex: 1 }}>
                  {s.title}
                </InkText>
              </GPressable>
            ))}
          </View>
        ) : null}
        <IdeaActions idea={idea} busy={busy} made={made} onGoose={onGoose} onMine={onMine} onChat={onChat} />
        {idea.state === 'new' ? (
          <InkButton size="sm" variant="quiet" onPress={onDismiss} style={styles.dismiss}>
            {t('goose.ideas.notForMe')}
          </InkButton>
        ) : null}
      </View>
    </InkCard>
  );
}

const styles = StyleSheet.create({
  flush: { padding: 0, gap: 0, overflow: 'hidden' },
  band: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  portraitPicture: { width: '100%', height: 168 },
  portraitWords: { paddingHorizontal: Spacing.md, paddingTop: Spacing.md, gap: 4, minHeight: 108 },
  portraitFoot: { padding: Spacing.md, paddingTop: Spacing.sm },
  panelPicture: { width: '100%', aspectRatio: 16 / 9 },
  panelWords: { padding: Spacing.lg, gap: Spacing.md },
  why: { borderLeftWidth: 3, paddingLeft: Spacing.md, gap: 2 },
  steps: { gap: 6 },
  facts: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10 },
  fact: { flexDirection: 'row', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  factLabel: { width: 96 },
  sources: { gap: 6 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  state: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm, borderRadius: 10 },
  made: { gap: 5 },
  doneLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dismiss: { alignSelf: 'flex-start' },
});
