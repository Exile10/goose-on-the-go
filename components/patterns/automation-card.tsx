/**
 * AutomationCard — one sensor-triggered rule: what it listens for, when it
 * last fired, and a switch. No Run now: a rule fires on a matching reading,
 * and the Pond's `/rules` routes have no way to fire one by hand.
 *
 * The top of the card opens the rule for editing; the switch sits below it,
 * not inside the same pressable, as on a schedule's card.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkBadge, InkCard, InkText } from '@/components/ui/ink';

import { LabelledSwitch } from '@/components/patterns/labelled-switch';
import { GPressable } from '@/components/ui/g-pressable';
import { formatScheduleTime } from '@/models/schedule';
import { describeCameraTrigger } from '@/models/vision';
import { toggle } from '@/services/haptics';
import type { TranslationKey } from '@/services/i18n';
import type { Rule, TriggerCondition, TriggerSource } from '@/services/types';
import { Spacing } from '@/constants/spacing';

export interface AutomationCardProps {
  rule: Rule;
  onOpen: (rule: Rule) => void;
  onSetPaused: (rule: Rule, paused: boolean) => void;
  /** A household member's name from a face signal's profile id, for a rule that listens to a camera. */
  nameOf?: (profileId: string) => string | null;
  /** False draws the card on a hairline, for a list in which every card raised would leave none standing out. */
  raised?: boolean;
}

const NO_NAMES = () => null;

/** Comparison symbols read the same in every language. */
function opSymbol(op: NonNullable<TriggerCondition['op']>): string {
  switch (op) {
    case 'gt':
      return '>';
    case 'gte':
      return '≥';
    case 'lt':
      return '<';
    case 'lte':
      return '≤';
    case 'eq':
      return '=';
  }
}

export function sourceKey(kind: TriggerSource['kind']): TranslationKey {
  switch (kind) {
    case 'sensor':
      return 'schedule.card.sourceSensor';
    case 'camera':
      return 'schedule.card.sourceCamera';
    case 'device':
      return 'schedule.card.sourceDevice';
  }
}

export const AutomationCard = React.memo(function AutomationCard({
  rule,
  onOpen,
  onSetPaused,
  nameOf = NO_NAMES,
  raised = true,
}: AutomationCardProps) {
  const { t } = useTranslation();
  const subject = rule.source.signal ?? rule.source.device_id ?? t(sourceKey(rule.source.kind));
  const { op, value } = rule.condition ?? {};
  // A camera's signal is a kind of thing and its confidence a fraction, so it reads as a sentence.
  const trigger =
    rule.source.kind === 'camera'
      ? describeCameraTrigger(rule, nameOf)
      : op && value != null
        ? t('schedule.card.whenCompared', { subject, op: opSymbol(op), value })
        : t('schedule.card.when', { subject });

  return (
    <InkCard raised={raised} style={rule.paused ? styles.paused : undefined}>
      <GPressable onPress={() => onOpen(rule)} accessibilityRole="button">
        <View style={styles.top}>
          <View style={styles.title}>
            <InkText weight="semibold">{rule.name}</InkText>
            <InkText size="sm" tone="secondary">
              {trigger} · {t('schedule.card.actions', { count: rule.actions.length })}
            </InkText>
          </View>
          <InkBadge tone="neutral">{t(sourceKey(rule.source.kind))}</InkBadge>
        </View>

        <View style={styles.status}>
          {rule.currently_running ? (
            <InkBadge tone="brand">{t('schedule.card.running')}</InkBadge>
          ) : (
            <InkText size="sm" tone="tertiary">
              {rule.last_fired
                ? t('schedule.card.lastFired', { when: formatScheduleTime(rule.last_fired) })
                : t('schedule.card.neverFired')}
            </InkText>
          )}
          <InkText size="sm" tone="tertiary">
            {t('schedule.card.cooldown', { seconds: rule.cooldown_secs })}
          </InkText>
        </View>
      </GPressable>

      <View style={styles.actions}>
        <LabelledSwitch
          label={rule.paused ? t('schedule.card.paused') : t('schedule.card.enabled')}
          checked={!rule.paused}
          onChange={(on) => {
            void toggle();
            onSetPaused(rule, !on);
          }}
        />
      </View>
    </InkCard>
  );
});

const styles = StyleSheet.create({
  paused: { opacity: 0.6 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  title: { flex: 1, gap: Spacing.xs },
  status: { marginTop: Spacing.sm, gap: Spacing.xs },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md },
});
