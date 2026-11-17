/**
 * What the plan, the finished-work and the questions screens share, and Home borrows: the reason
 * chips, one of Goose's questions with its options and an "Other" field, the running job's steps,
 * a plan's facts, a row for a piece of work, and the sheets that stop a plan or wave work off.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  InkButton,
  InkChip,
  InkChoice,
  InkEyebrow,
  InkInput,
  InkRadioGroup,
  InkSegmented,
  InkSheet,
  InkSwitch,
  InkText,
  InkTextArea,
  InkTimeline,
  useInkTheme,
} from '@/components/ui/ink';

import { Spacing } from '@/constants/spacing';
import { GPressable } from '@/components/ui/g-pressable';
import {
  anchorKindKey,
  deliverableKindKey,
  deliverableStateKey,
  reasonKey,
  REASONS,
  stepState,
  type Anchor,
  type AnchorFact,
  type DeliverableSummary,
  type EngineJobNow,
  type Question,
  type RejectReason,
} from '@/models/anchors';
import { canAnswer, type AnswerDraft, type UseQuestions } from '@/view-models/use-questions';
import type { RejectVerb } from '@/view-models/use-deliverable';
import { RoundButton } from './hub-parts';
import { GroupRow } from './following';
import { Labelled } from './labelled';

/** The five reasons, as chips the member toggles. */
export function ReasonChips({ selected, onToggle }: { selected: readonly RejectReason[]; onToggle: (reason: RejectReason) => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.chips} accessibilityLabel={t('goose.reasons.title')}>
      {REASONS.map((reason) => (
        <InkChip key={reason} selected={selected.includes(reason)} onPress={() => onToggle(reason)}>
          {t(reasonKey(reason))}
        </InkChip>
      ))}
    </View>
  );
}

/** A reason added or taken away, for a sheet's own state. */
export function toggleReason(reasons: readonly RejectReason[], reason: RejectReason): RejectReason[] {
  return reasons.includes(reason) ? reasons.filter((r) => r !== reason) : [...reasons, reason];
}

// The radio's values are positions, so an option worded like "other" never collides with Other.
const OTHER = 'other';

export interface QuestionCardProps {
  question: Question;
  draft: AnswerDraft;
  busy: boolean;
  onChoose: (option: string) => void;
  onOther: (on: boolean) => void;
  onOtherText: (text: string) => void;
  onAnswer: () => void;
  onSkip: () => void;
}

/** One question: its options as a radio group (or choices when several fit), "Other" with a field, Send and Skip. */
export function QuestionCard({ question, draft, busy, onChoose, onOther, onOtherText, onAnswer, onSkip }: QuestionCardProps) {
  const { t } = useTranslation();
  const ready = canAnswer(draft);
  const picked = draft.other ? OTHER : String(question.options.findIndex((o) => draft.choices.includes(o)));
  return (
    <View style={styles.question}>
      {question.multi ? (
        <View style={styles.question}>
          <InkText weight="semibold">{question.text}</InkText>
          <InkText size="sm" tone="secondary">
            {t('goose.questions.pickSeveral')}
          </InkText>
          <View style={styles.chips}>
            {question.options.map((option) => (
              <InkChoice key={option} selected={draft.choices.includes(option)} onSelect={() => onChoose(option)}>
                {option}
              </InkChoice>
            ))}
            <InkChoice selected={draft.other} onSelect={() => onOther(!draft.other)}>
              {t('goose.questions.other')}
            </InkChoice>
          </View>
        </View>
      ) : (
        <InkRadioGroup
          label={question.text}
          value={picked}
          options={[...question.options.map((option, i) => ({ value: String(i), label: option })), { value: OTHER, label: t('goose.questions.other') }]}
          onChange={(value) => (value === OTHER ? onOther(true) : onChoose(question.options[Number(value)] ?? ''))}
        />
      )}
      {draft.other ? <InkInput label={t('goose.questions.other')} value={draft.text} onChange={onOtherText} placeholder={t('goose.questions.otherPlaceholder')} /> : null}
      <View style={styles.actions}>
        <InkButton variant="quiet" disabled={busy} onPress={onSkip}>
          {t('goose.questions.skip')}
        </InkButton>
        <InkButton variant="primary" loading={busy} disabled={!ready || busy} onPress={onAnswer}>
          {t('goose.questions.answer')}
        </InkButton>
      </View>
    </View>
  );
}

/** A plan Goose offered: what it is, why Goose thinks it matters, and the member's yes or not now. */
export function CandidateBlock({ anchor, busy, onYes, onNo, onOpen }: { anchor: Anchor; busy: boolean; onYes: () => void; onNo: () => void; onOpen?: () => void }) {
  const { t } = useTranslation();
  const words = (
    <View style={styles.fill}>
      <InkText size="sm" tone="secondary">
        {t(anchorKindKey(anchor.kind))}
      </InkText>
      <InkText weight="semibold">{anchor.title}</InkText>
      {anchor.why ? (
        <InkText size="sm" tone="secondary">
          {anchor.why}
        </InkText>
      ) : null}
    </View>
  );
  return (
    <View style={styles.block}>
      {onOpen ? (
        <GPressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={anchor.title}>
          {words}
        </GPressable>
      ) : (
        words
      )}
      <View style={styles.actions}>
        <InkButton variant="quiet" disabled={busy} onPress={onNo}>
          {t('home.plans.notNow')}
        </InkButton>
        <InkButton variant="primary" loading={busy} disabled={busy} onPress={onYes}>
          {t('home.plans.yes')}
        </InkButton>
      </View>
    </View>
  );
}

/** Every batch the view-model holds, each under its title, its questions answerable in place. */
export function QuestionBatchList({ vm, titles = true, onOpenPlan }: { vm: UseQuestions; titles?: boolean; onOpenPlan?: (anchorId: string) => void }) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  return (
    <View style={styles.batches}>
      {vm.batches.map((batch) => (
        <View key={batch.id} style={styles.block}>
          {titles && batch.title ? <InkText weight="bold">{batch.title}</InkText> : null}
          {batch.questions.map((question, i) => (
            <View key={question.id} style={i > 0 ? [styles.divided, { borderTopColor: theme.color.line }] : null}>
              <QuestionCard
                question={question}
                draft={vm.draftOf(question.id)}
                busy={vm.busy === question.id}
                onChoose={(option) => vm.actions.choose(question, option)}
                onOther={(on) => vm.actions.chooseOther(question, on)}
                onOtherText={(text) => vm.actions.setOtherText(question, text)}
                onAnswer={() => void vm.actions.answer(question)}
                onSkip={() => void vm.actions.skip(question)}
              />
            </View>
          ))}
          {onOpenPlan && batch.anchorId ? (
            <InkButton variant="quiet" icon="calendar" onPress={() => onOpenPlan(batch.anchorId!)} style={styles.left}>
              {t('goose.questions.openPlan')}
            </InkButton>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** What Goose is doing for a plan now: the job in words, how often its checker looked, and its steps. */
export function JobSteps({ job }: { job: EngineJobNow }) {
  const { t } = useTranslation();
  return (
    <View style={styles.block}>
      <InkText weight="semibold">{job.state === 'running' ? t('goose.anchor.working') : t('goose.anchor.queued')}</InkText>
      {job.subject ? <InkText tone="secondary">{job.subject}</InkText> : null}
      {job.rounds > 0 ? (
        <InkText size="sm" tone="secondary">
          {t('goose.anchor.rounds', { count: job.rounds })}
        </InkText>
      ) : null}
      {job.steps.length > 0 ? (
        <InkTimeline
          label={t('goose.anchor.steps')}
          entries={job.steps.map((step) => ({ key: step.key, title: step.label, description: step.summary ?? undefined, state: stepState(step) }))}
        />
      ) : null}
    </View>
  );
}

/** A plan's or a piece of work's facts, a label over its value; the owner can take a wrong one off. */
export function FactRows({ facts, onRemove }: { facts: readonly AnchorFact[]; onRemove?: (fact: AnchorFact) => void }) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  return (
    <View style={styles.facts}>
      {facts.map((fact, i) => (
        <View key={`${fact.label}-${i}`} style={[styles.fact, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.line } : null]}>
          <View style={styles.fill}>
            <InkText size="sm" tone="secondary">
              {fact.label}
            </InkText>
            <InkText>{fact.value}</InkText>
          </View>
          {onRemove ? <RoundButton icon="x" size={28} label={t('goose.anchor.removeFact', { label: fact.label })} onPress={() => onRemove(fact)} /> : null}
        </View>
      ))}
    </View>
  );
}

/** A piece of work in a list: its kind, its title and its line, or where it is when not ready. */
export function DeliverableRow({ deliverable, first, onOpen }: { deliverable: DeliverableSummary; first: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const state = deliverableStateKey(deliverable.state);
  const detail = state ? t(state) : deliverable.state === 'unsure' ? t('home.ready.unsure') : deliverable.hook || t(deliverableKindKey(deliverable.kind));
  return <GroupRow first={first} icon={deliverable.unseen ? 'sparkle' : 'file-text'} label={deliverable.title} detail={detail} muted={state !== null} onPress={onOpen} />;
}

export interface StopSheetProps {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onStop: (reasons: RejectReason[], words: string, never: boolean) => Promise<boolean>;
}

/** Stopping a plan: why, in chips and words if the member likes, and whether never to suggest it again. */
export function StopSheet({ open, busy, onClose, onStop }: StopSheetProps) {
  const { t } = useTranslation();
  const [reasons, setReasons] = useState<RejectReason[]>([]);
  const [words, setWords] = useState('');
  const [never, setNever] = useState(false);
  return (
    <InkSheet open={open} onClose={onClose} title={t('goose.anchor.stopTitle')} description={t('goose.anchor.stopBody')} scroll>
      <View style={styles.sheet}>
        <View style={styles.block}>
          <InkEyebrow>{t('goose.reasons.title')}</InkEyebrow>
          <ReasonChips selected={reasons} onToggle={(r) => setReasons((all) => toggleReason(all, r))} />
        </View>
        <Labelled label={t('goose.reasons.words')}>
          <InkTextArea label={t('goose.reasons.words')} value={words} onChange={setWords} placeholder={t('goose.reasons.wordsPlaceholder')} rows={2} maxRows={4} />
        </Labelled>
        <InkSwitch checked={never} label={t('goose.anchor.never')} onChange={setNever}>
          <View style={styles.fill}>
            <InkText weight="semibold">{t('goose.anchor.never')}</InkText>
            <InkText size="sm" tone="secondary">
              {t('goose.anchor.neverBody')}
            </InkText>
          </View>
        </InkSwitch>
        <InkButton
          variant="danger"
          block
          loading={busy}
          onPress={async () => {
            if (await onStop(reasons, words, never)) onClose();
          }}
        >
          {t('goose.anchor.stopConfirm')}
        </InkButton>
      </View>
    </InkSheet>
  );
}

export interface RejectSheetProps {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onReject: (verb: RejectVerb, reasons: RejectReason[], words: string) => Promise<boolean>;
}

/** Waving work off: this one only, or never anything like it, with reason chips and words. */
export function RejectSheet({ open, busy, onClose, onReject }: RejectSheetProps) {
  const { t } = useTranslation();
  const [verb, setVerb] = useState<RejectVerb>('not_this');
  const [reasons, setReasons] = useState<RejectReason[]>([]);
  const [words, setWords] = useState('');
  return (
    <InkSheet open={open} onClose={onClose} title={t('goose.deliverable.rejectTitle')} scroll>
      <View style={styles.sheet}>
        <InkSegmented
          label={t('goose.deliverable.rejectTitle')}
          value={verb}
          options={[
            { value: 'not_this', label: t('goose.deliverable.notThis') },
            { value: 'never', label: t('goose.deliverable.never') },
          ]}
          onChange={setVerb}
        />
        <InkText size="sm" tone="secondary">
          {verb === 'never' ? t('goose.deliverable.neverBody') : t('goose.deliverable.notThisBody')}
        </InkText>
        <View style={styles.block}>
          <InkEyebrow>{t('goose.reasons.title')}</InkEyebrow>
          <ReasonChips selected={reasons} onToggle={(r) => setReasons((all) => toggleReason(all, r))} />
        </View>
        <Labelled label={t('goose.reasons.words')}>
          <InkTextArea label={t('goose.reasons.words')} value={words} onChange={setWords} placeholder={t('goose.reasons.wordsPlaceholder')} rows={2} maxRows={4} />
        </Labelled>
        <InkButton
          variant="primary"
          block
          loading={busy}
          onPress={async () => {
            if (await onReject(verb, reasons, words)) onClose();
          }}
        >
          {t('goose.deliverable.rejectConfirm')}
        </InkButton>
      </View>
    </InkSheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  question: { gap: Spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
  block: { gap: Spacing.sm },
  facts: { gap: 0 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  fill: { flex: 1, gap: 2 },
  sheet: { gap: Spacing.lg, paddingBottom: Spacing.lg },
  batches: { gap: Spacing.xl },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.md, marginTop: Spacing.xs },
  left: { alignSelf: 'flex-start' },
});
