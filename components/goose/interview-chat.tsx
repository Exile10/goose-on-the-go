/**
 * The interests interview as a chat: Goose asks one question at a time, the member taps answers
 * (several, when the question allows) or types one, and Goose digs into each. While the Pond writes
 * the next question the chat says so. At the end the member sees what Goose drafted, keeps or edits
 * each, and saves them. Goose's words are the page's text and the member's are bubbles, as in a
 * conversation.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InkBubble, InkButton, InkCheckbox, InkChoice, InkInput, InkMeter, InkSpinner, InkText, InkTyping, inkText, useInkTheme } from '@/components/ui/ink';

import { GKeyboardView, useFocusedInputReveal } from '@/components/ui/g-keyboard-view';
import { Spacing } from '@/constants/spacing';
import { categoryKey, depthKey, interviewProgress, newsKey, type Interest } from '@/models/interests';
import { selectionTick, tap } from '@/services/haptics';
import type { InterestEdit } from '@/view-models/use-interests';
import type { UseInterestsInterview } from '@/view-models/use-interests-interview';
import { RoundButton } from './hub-parts';
import { InterestSheet } from './interest-sheet';

function Intro({ vm, onSkip }: { vm: UseInterestsInterview; onSkip?: () => void }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const title = inkText(theme, { role: 'display', size: '3xl', weight: 700, tracking: 'title', leading: 'tight', color: theme.color.text }).style;
  const again = vm.data.status === 'done';
  return (
    <View style={styles.intro}>
      <Text style={title} accessibilityRole="header">
        {again ? t('goose.interview.againTitle') : t('goose.interview.introTitle')}
      </Text>
      <InkText size="lg" tone="secondary">
        {again ? t('goose.interview.againBody') : t('goose.interview.introBody')}
      </InkText>
      <View style={styles.introActions}>
        <InkButton variant="primary" icon="chat" loading={vm.sending} onPress={() => void vm.actions.start()}>
          {again ? t('goose.interview.startAgain') : t('goose.interview.start')}
        </InkButton>
        {onSkip ? (
          <InkButton variant="quiet" onPress={onSkip}>
            {t('goose.interview.skip')}
          </InkButton>
        ) : null}
      </View>
    </View>
  );
}

function Review({ vm, onSaved }: { vm: UseInterestsInterview; onSaved: () => void }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const draft = vm.data.draft;
  const [keep, setKeep] = useState<Set<string>>(() => new Set(draft.map((d) => d.id)));
  const [edits, setEdits] = useState<Record<string, InterestEdit & { topic: string }>>({});
  const [editing, setEditing] = useState<Interest | null>(null);
  const shown = (d: Interest): Interest => ({ ...d, ...(edits[d.id] ?? {}) });
  return (
    <View style={styles.review}>
      <InkText size="xl" weight="bold">
        {t('goose.interview.reviewTitle')}
      </InkText>
      <InkText tone="secondary">{t('goose.interview.reviewBody')}</InkText>
      {draft.map((d) => {
        const s = shown(d);
        const on = keep.has(d.id);
        return (
          <View key={d.id} style={[styles.draft, { borderColor: on ? theme.color.accentLine : theme.color.line, backgroundColor: on ? theme.color.accentSofter : 'transparent' }]}>
            <View style={styles.fill}>
            <InkCheckbox
              checked={on}
              label={t('goose.interview.keepLabel', { topic: s.topic })}
              onChange={(v) =>
                setKeep((all) => {
                  const next = new Set(all);
                  if (v) next.add(d.id);
                  else next.delete(d.id);
                  return next;
                })
              }
            >
              <View style={styles.draftWords}>
                <InkText weight="bold">{s.topic}</InkText>
                <InkText size="sm" tone="secondary">
                  {[t(categoryKey(s.category)), t(depthKey(s.depth)), t(newsKey(s.news))].join(', ')}
                </InkText>
                {s.facets.length ? <InkText size="sm">{s.facets.join(', ')}</InkText> : null}
              </View>
            </InkCheckbox>
            </View>
            <RoundButton icon="edit" size={32} label={t('goose.interests.editTitle', { topic: s.topic })} onPress={() => setEditing(s)} />
          </View>
        );
      })}
      <InkButton
        variant="primary"
        block
        loading={vm.sending}
        disabled={keep.size === 0}
        onPress={async () => {
          const kept = [...keep];
          const saved = await vm.actions.approve(
            kept,
            Object.fromEntries(Object.entries(edits).filter(([id]) => keep.has(id))),
          );
          if (saved !== null) onSaved();
        }}
      >
        {t('goose.interview.approve', { count: keep.size })}
      </InkButton>
      <InterestSheet
        open={!!editing}
        interest={editing}
        onClose={() => setEditing(null)}
        onSave={async (edit) => {
          if (editing) setEdits((all) => ({ ...all, [editing.id]: edit }));
          return true;
        }}
      />
    </View>
  );
}

export function InterviewChat({ vm, onSkip, onFinished }: { vm: UseInterestsInterview; onSkip?: () => void; onFinished: () => void }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const scroll = useRef<ScrollView>(null);
  const reveal = useFocusedInputReveal(() => scroll.current);
  // Picks belong to the question they were made on; a new question starts with none.
  const [pickedFor, setPickedFor] = useState<{ question: string; items: string[] }>({ question: '', items: [] });
  const [typed, setTyped] = useState('');
  const insets = useSafeAreaInsets();
  const { data, question } = vm;
  const progress = interviewProgress(data);
  const goose = inkText(theme, { role: 'display', size: 'xl', weight: 600, tracking: 'tight', leading: 'snug', color: theme.color.text }).style;
  const earlier = inkText(theme, { role: 'display', size: 'md', weight: 600, leading: 'snug', color: theme.color.textSecondary }).style;

  const picked = question && pickedFor.question === question.id ? pickedFor.items : [];
  const setPicked = (update: (all: string[]) => string[]) => setPickedFor({ question: question?.id ?? '', items: update(picked) });

  useEffect(() => {
    const timer = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 120);
    return () => clearTimeout(timer);
  }, [question?.id, data.status, data.turns.length]);

  if (vm.loading) return <InkSpinner label={t('goose.interview.loading')} />;
  if (data.status === 'not_started' || data.status === 'done') return <Intro vm={vm} onSkip={onSkip} />;

  const send = (choices: string[], text?: string) => {
    void tap();
    setTyped('');
    void vm.actions.answer({ choices, text });
  };

  return (
    <GKeyboardView style={styles.fill}>
      <ScrollView ref={scroll} style={styles.fill} contentContainerStyle={styles.chat} showsVerticalScrollIndicator={false} {...reveal}>
        {progress && data.status !== 'review' ? (
          <View style={styles.progress}>
            <InkText size="sm" weight="semibold" tone="secondary">
              {t('goose.interview.progress', { asked: progress.asked, planned: progress.planned })}
            </InkText>
            <InkMeter value={progress.asked / progress.planned} label={t('goose.interview.progress', { asked: progress.asked, planned: progress.planned })} />
          </View>
        ) : null}
        {data.turns.map((turn, i) =>
          turn.role === 'goose' ? (
            // Questions already answered step back, so the one being asked is the one that reads.
            <Text key={turn.id} style={i === data.turns.length - 1 && data.status !== 'review' ? goose : earlier}>
              {turn.text}
            </Text>
          ) : (
            <View key={turn.id} style={styles.mine}>
              <InkBubble mine>{turn.text}</InkBubble>
            </View>
          ),
        )}
        {data.status === 'thinking' ? (
          <View style={styles.thinking}>
            <InkTyping author={t('goose.interview.goose')} />
            <InkText size="sm" tone="secondary">
              {t('goose.interview.thinking')}
            </InkText>
          </View>
        ) : null}
        {question && question.choices.length ? (
          <View style={styles.choices}>
            {question.choices.map((c) => (
              <InkChoice
                key={c}
                shape="pill"
                selected={picked.includes(c)}
                disabled={vm.sending}
                onSelect={() => {
                  void selectionTick();
                  if (!question.multi) send([c]);
                  else setPicked((all) => (all.includes(c) ? all.filter((x) => x !== c) : [...all, c]));
                }}
              >
                {c}
              </InkChoice>
            ))}
          </View>
        ) : null}
        {question?.multi && picked.length ? (
          <InkButton variant="primary" icon="send" loading={vm.sending} onPress={() => send(picked, typed.trim() || undefined)} style={styles.left}>
            {t('goose.interview.sendPicked', { count: picked.length })}
          </InkButton>
        ) : null}
        {/* Keyed on the draft, so a new draft starts with every row kept. */}
        {data.status === 'review' ? <Review key={data.draft.map((d) => d.id).join(',')} vm={vm} onSaved={onFinished} /> : null}
      </ScrollView>

      {data.status !== 'review' ? (
        <View style={[styles.dock, { borderTopColor: theme.color.line, backgroundColor: theme.color.bg, paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
          {question?.allowFree ? (
            <View style={styles.typeRow}>
              <View style={styles.fill}>
                <InkInput
                  value={typed}
                  onChange={setTyped}
                  placeholder={t('goose.interview.typePlaceholder')}
                  label={t('goose.interview.typeLabel')}
                  onSubmit={() => typed.trim() && send(picked, typed.trim())}
                  disabled={vm.sending}
                />
              </View>
              <RoundButton icon="send" size={44} label={t('goose.interview.send')} onPress={() => typed.trim() && send(picked, typed.trim())} />
            </View>
          ) : null}
          <View style={styles.dockActions}>
            {onSkip ? (
              <InkButton variant="quiet" size="sm" onPress={onSkip}>
                {t('goose.interview.later')}
              </InkButton>
            ) : (
              <View />
            )}
            <InkButton variant="quiet" size="sm" icon="check" disabled={vm.sending || data.turns.length < 2} onPress={() => void vm.actions.finish()}>
              {t('goose.interview.finish')}
            </InkButton>
          </View>
        </View>
      ) : null}
    </GKeyboardView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  intro: { gap: Spacing.md, padding: Spacing.lg },
  introActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  chat: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing['2xl'] },
  mine: { alignItems: 'flex-end' },
  progress: { gap: 6 },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  left: { alignSelf: 'flex-start' },
  dock: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.sm, gap: Spacing.xs, borderTopWidth: StyleSheet.hairlineWidth },
  typeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  dockActions: { flexDirection: 'row', justifyContent: 'space-between' },
  review: { gap: Spacing.md },
  draft: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md, borderRadius: 14, borderWidth: 1 },
  draftWords: { flex: 1, gap: 2 },
});
