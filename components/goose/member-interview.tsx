/**
 * The member's interview: one question at a time with small tap answers, a spinner while the Pond
 * writes up what was typed, then two short lists of what it would keep, each row ticked until the
 * member unticks or rewords it. The controls that move it on stay docked at the foot.
 */

import React, { useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InkButton, InkCheckbox, InkChoice, InkInput, InkMeter, InkSpinner, InkSwitch, InkText, InkTextArea, inkText, useInkTheme } from '@/components/ui/ink';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { GIcon } from '@/components/ui/g-icon';
import { GKeyboardView, useFocusedInputReveal } from '@/components/ui/g-keyboard-view';
import { GPressable } from '@/components/ui/g-pressable';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { isUnavailable } from '@/models/content-state';
import { selectionTick, tap, toggle } from '@/services/haptics';
import { useContentState } from '@/view-models/use-content-state';
import { newsWishKey, type UseMemberInterview } from '@/view-models/use-member-interview';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { InsetGroup } from './following';

function Page({ vm, dock, children }: { vm: UseMemberInterview; dock?: React.ReactNode; children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const pull = usePullToRefresh(vm.actions.reload);
  const scroll = useRef<ScrollView>(null);
  const reveal = useFocusedInputReveal(() => scroll.current);
  return (
    <GKeyboardView style={styles.page}>
      <ScrollView
        ref={scroll}
        style={styles.fill}
        contentContainerStyle={[styles.content, { paddingBottom: dock ? Spacing.xl : insets.bottom + Spacing['2xl'] }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pull} />}
        {...reveal}
      >
        {children}
      </ScrollView>
      {dock ? <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>{dock}</View> : null}
    </GKeyboardView>
  );
}

function ListLabel({ children }: { children: string }) {
  const theme = useInkTheme();
  return (
    <Text accessibilityRole="header" style={inkText(theme, { size: 'sm', weight: 600, color: theme.color.textSecondary }).style}>
      {children}
    </Text>
  );
}

function Intro({ vm }: { vm: UseMemberInterview }) {
  const { t } = useTranslation();
  return (
    <Page vm={vm}>
      <InkText size="md" tone="secondary">
        {t('goose.interviewOne.lead')}
      </InkText>
      <InkButton
        variant="primary"
        loading={vm.busy}
        onPress={() => {
          void tap();
          void vm.actions.start();
        }}
      >
        {t('goose.interviewOne.start')}
      </InkButton>
    </Page>
  );
}

function Done({ vm, onSeeAbout }: { vm: UseMemberInterview; onSeeAbout: () => void }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  return (
    <Page vm={vm}>
      <View style={styles.words}>
        <Text accessibilityRole="header" style={inkText(theme, { role: 'display', size: 'xl', weight: 700, tracking: 'title', color: theme.color.text }).style}>
          {t('goose.interviewOne.doneTitle')}
        </Text>
        <InkText size="md" tone="secondary">
          {t('goose.interviewOne.doneBody')}
        </InkText>
      </View>
      <View style={styles.actions}>
        <InkButton
          variant="primary"
          onPress={() => {
            void tap();
            onSeeAbout();
          }}
        >
          {t('goose.interviewOne.seeAbout')}
        </InkButton>
        <InkButton
          variant="quiet"
          loading={vm.busy}
          onPress={() => {
            void tap();
            void vm.actions.start();
          }}
        >
          {t('goose.interviewOne.again')}
        </InkButton>
      </View>
    </Page>
  );
}

function Thinking({ vm }: { vm: UseMemberInterview }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  return (
    <Page vm={vm}>
      <View style={styles.waiting} accessibilityLiveRegion="polite">
        <InkSpinner label={t('goose.interviewOne.thinking')} />
        {/* The spinner already carries these words for a screen reader. */}
        <View style={styles.fill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <InkText size="md" tone="secondary">
            {t('goose.interviewOne.thinking')}
          </InkText>
        </View>
      </View>
    </Page>
  );
}

interface Draft {
  question: string;
  picked: string[];
  typed: string;
}

function Asking({ vm }: { vm: UseMemberInterview }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const { data, question, busy } = vm;
  // The Pond counts sections finished; the member is on the one after that.
  const total = data.progress.total;
  const done = Math.min(data.progress.done + 1, total);
  // Taps and typing belong to the question they were made on; the next one starts with none.
  const [draft, setDraft] = useState<Draft>({ question: '', picked: [], typed: '' });
  const id = question?.id ?? '';
  const mine: Draft = draft.question === id ? draft : { question: id, picked: [], typed: '' };
  const ready = mine.picked.length > 0 || mine.typed.trim().length > 0;
  const hint = question && question.choices.length > 0 ? t('goose.interviewOne.typeAnswer') : t('goose.interviewOne.typeOnly');
  const count = t('goose.interviewOne.progress', { done, total });

  const send = () => {
    if (!ready) return;
    void tap();
    void vm.actions.answer({ choices: mine.picked, text: mine.typed });
  };

  const dock = (
    <>
      {question?.allowFree ? (
        <View style={styles.entry}>
          <View style={styles.fill}>
            <InkInput
              value={mine.typed}
              onChange={(typed) => setDraft({ ...mine, typed })}
              label={hint}
              placeholder={hint}
              disabled={busy}
              onSubmit={send}
              inputProps={{ returnKeyType: 'send' }}
            />
          </View>
          <InkButton variant="primary" disabled={busy || !ready} onPress={send}>
            {question.multi ? t('goose.interviewOne.next') : t('goose.interviewOne.send')}
          </InkButton>
        </View>
      ) : question?.multi ? (
        <InkButton variant="primary" block disabled={busy || !ready} onPress={send}>
          {t('goose.interviewOne.next')}
        </InkButton>
      ) : null}
      <View style={styles.dockActions}>
        <InkButton
          variant="quiet"
          size="sm"
          disabled={busy}
          onPress={() => {
            void tap();
            void vm.actions.finish();
          }}
        >
          {t('goose.interviewOne.finishEarly')}
        </InkButton>
        <InkButton
          variant="quiet"
          size="sm"
          disabled={busy}
          onPress={() => {
            void tap();
            void vm.actions.skip();
          }}
        >
          {t('goose.interviewOne.skip')}
        </InkButton>
      </View>
    </>
  );

  return (
    <Page vm={vm} dock={dock}>
      {total > 0 ? (
        <View style={styles.progress}>
          {/* The meter's label says both for a screen reader. */}
          <View style={styles.progressWords} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.fill}>
              <InkText size="sm" weight="semibold" tone="secondary" numberOfLines={1}>
                {data.heading ?? ''}
              </InkText>
            </View>
            <InkText size="sm" tone="secondary" numeric>
              {count}
            </InkText>
          </View>
          <InkMeter value={total ? data.progress.done / total : 0} label={data.heading ? t('goose.interviewOne.progressLabel', { done, total, heading: data.heading }) : count} />
        </View>
      ) : null}
      {question ? (
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          style={inkText(theme, { role: 'display', size: 'xl', weight: 600, tracking: 'tight', leading: 'snug', color: theme.color.text }).style}
        >
          {question.text}
        </Text>
      ) : null}
      {question && question.choices.length > 0 ? (
        <View style={styles.choices}>
          {question.choices.map((choice) => (
            <InkChoice
              key={choice}
              shape="pill"
              selected={mine.picked.includes(choice)}
              disabled={busy}
              onSelect={() => {
                void selectionTick();
                if (!question.multi) void vm.actions.answer({ choices: [choice] });
                else setDraft({ ...mine, picked: mine.picked.includes(choice) ? mine.picked.filter((c) => c !== choice) : [...mine.picked, choice] });
              }}
            >
              {choice}
            </InkChoice>
          ))}
        </View>
      ) : null}
    </Page>
  );
}

function Review({ vm }: { vm: UseMemberInterview }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const { busy } = vm;
  const { facts, interests, news, applyNews, keepCount } = vm.review;
  const { keepFact, keepInterest, reword, setApplyNews, approve } = vm.actions;
  // The field's own text, spaces and all; the view-model keeps the tidied sentence.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const drafted = facts.length + interests.length > 0;

  const dock = (
    <InkButton
      variant="primary"
      block
      loading={busy}
      onPress={() => {
        void tap();
        void approve();
      }}
    >
      {keepCount > 0 ? t('goose.interviewOne.keep', { count: keepCount }) : t('goose.interviewOne.keepNone')}
    </InkButton>
  );

  return (
    <Page vm={vm} dock={dock}>
      <View style={styles.words}>
        <Text accessibilityRole="header" style={inkText(theme, { role: 'display', size: 'lg', weight: 700, tracking: 'title', color: theme.color.text }).style}>
          {t('goose.interviewOne.reviewTitle')}
        </Text>
        <InkText size="sm" tone="secondary">
          {drafted ? t('goose.interviewOne.reviewLead') : t('goose.interviewOne.nothingDrafted')}
        </InkText>
      </View>

      {facts.length > 0 ? (
        <View style={styles.list}>
          <ListLabel>{t('goose.interviewOne.facts')}</ListLabel>
          <InsetGroup>
            {facts.map((fact, i) => (
              <View key={fact.id} style={[styles.row, i > 0 ? styles.divided : null]}>
                <InkCheckbox
                  checked={fact.kept}
                  // The label ends the sentence itself, so the sentence's own stop would be read twice.
                  label={t('goose.interviewOne.factToggle', { content: fact.content.replace(/[.!?]+$/, '') })}
                  disabled={busy}
                  onChange={(keep) => {
                    void toggle();
                    keepFact(fact.id, keep);
                  }}
                />
                {editing?.id === fact.id ? (
                  <View style={styles.fill}>
                    <InkTextArea
                      value={editing.text}
                      onChange={(text) => {
                        setEditing({ id: fact.id, text });
                        reword(fact.id, text);
                      }}
                      label={t('goose.interviewOne.editFactTitle')}
                      rows={1}
                      maxRows={5}
                      disabled={busy}
                      inputProps={{ autoFocus: true, submitBehavior: 'blurAndSubmit', returnKeyType: 'done', onSubmitEditing: () => setEditing(null) }}
                    />
                  </View>
                ) : (
                  <GPressable
                    style={styles.sentence}
                    disabled={busy}
                    onPress={() => {
                      void selectionTick();
                      setEditing({ id: fact.id, text: fact.content });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={fact.content}
                    accessibilityHint={t('goose.interviewOne.editFact')}
                  >
                    <View style={styles.fill}>
                      <InkText size="md" tone={fact.kept ? 'default' : 'tertiary'}>
                        {fact.content}
                      </InkText>
                    </View>
                    <GIcon name="edit" size={14} color={theme.color.textTertiary} />
                  </GPressable>
                )}
              </View>
            ))}
          </InsetGroup>
        </View>
      ) : null}

      {interests.length > 0 ? (
        <View style={styles.list}>
          <ListLabel>{t('goose.interviewOne.interests')}</ListLabel>
          <InsetGroup>
            {interests.map((interest, i) => (
              <View key={interest.id} style={[styles.row, i > 0 ? styles.divided : null]}>
                <InkCheckbox
                  checked={interest.kept}
                  disabled={busy}
                  style={styles.fill}
                  onChange={(keep) => {
                    void toggle();
                    keepInterest(interest.id, keep);
                  }}
                >
                  {interest.topic}
                </InkCheckbox>
              </View>
            ))}
          </InsetGroup>
        </View>
      ) : null}

      {news ? (
        <View style={styles.list}>
          <ListLabel>{t('goose.interviewOne.newsTitle')}</ListLabel>
          <InsetGroup>
            <View style={styles.row}>
              <View style={styles.newsWords}>
                <InkText size="md">{t(newsWishKey(news))}</InkText>
                <InkText size="sm" tone="secondary">
                  {t('goose.interviewOne.newsApply')}
                </InkText>
              </View>
              <InkSwitch
                checked={applyNews}
                label={t('goose.interviewOne.newsApply')}
                disabled={busy}
                onChange={(apply) => {
                  void toggle();
                  setApplyNews(apply);
                }}
              />
            </View>
          </InsetGroup>
        </View>
      ) : null}
    </Page>
  );
}

export function MemberInterviewView({ vm, onSeeAbout }: { vm: UseMemberInterview; onSeeAbout: () => void }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  // A read that worked once is content: a later one that fails keeps the interview on screen.
  const state = useContentState({ loading: vm.loading, failed: vm.failed, hasContent: !vm.loading && !vm.failed });

  if (state === 'loading') {
    return (
      <Page vm={vm}>
        <View style={styles.waiting}>
          <InkSpinner label={t('goose.interviewOne.loading')} />
        </View>
      </Page>
    );
  }
  if (isUnavailable(state)) {
    return (
      <Page vm={vm}>
        <ContentUnavailable state={state} reason={vm.error} onRetry={vm.actions.reload} />
      </Page>
    );
  }
  switch (vm.data.status) {
    case 'not_started':
      return <Intro vm={vm} />;
    case 'asking':
      return <Asking vm={vm} />;
    case 'thinking':
      return <Thinking vm={vm} />;
    case 'review':
      return <Review vm={vm} />;
    case 'done':
      return <Done vm={vm} onSeeAbout={onSeeAbout} />;
  }
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.background },
    fill: { flex: 1 },
    content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, gap: Spacing.lg },
    dock: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
      gap: Spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      backgroundColor: c.background,
    },
    dockActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    entry: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    words: { gap: Spacing.xs },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    waiting: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    progress: { gap: 6 },
    progressWords: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    list: { gap: Spacing.xs },
    row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 48, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
    divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    sentence: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
    newsWords: { flex: 1, gap: 1 },
  });
