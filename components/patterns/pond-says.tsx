/**
 * PondSays — the one thing Home states, in the Pond's own voice.
 *
 * Home used to open on a greeting and three counters, which is what any screen with a user and
 * some numbers opens on. The characteristic thing about this product is not that it knows your
 * name: it is that something of yours has been thinking about your house while you were out. So
 * that is what the top of the screen says, and it says it as a sentence rather than as a card
 * with a label.
 *
 * Set in the display italic, which is the most recognisable thing in this typography and was
 * being spent on the user's first name. One sentence is the whole point -- two proposals side by
 * side is a list, and a list is not a statement. The rest wait behind See all.
 *
 * What it says, in order of what is true:
 *
 * 1. A proposal, with the Pond's reason under it and a yes or no. Accepting records the yes and
 *    runs nothing (`ProposalDecisionResult.executed` is always false), which is the only reason
 *    deciding belongs this far forward.
 * 2. Reminders waiting, when nothing is proposed, leading to where they are dismissed.
 * 3. That nothing needs you -- which is worth saying plainly rather than leaving a gap.
 *
 * Draws nothing while the Pond cannot be reached: the card below is already saying so, and a
 * sentence about an unreachable Pond would be a second voice saying the same thing.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkText, InkTitle, useInkTheme } from '@jarida/ink/native';

import { GPressable } from '@/components/ui/g-pressable';
import { selectionTick } from '@/services/haptics';
import type { ProposalRow } from '@/view-models/use-proposals';

export interface PondSaysProps {
  lead: ProposalRow | null;
  reminderCount: number;
  deciding: string | null;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
}

export function PondSays({ lead, reminderCount, deciding, onAccept, onDecline }: PondSaysProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useInkTheme();
  const styles = makeStyles(theme);

  // `InkTitle`, not a hand-set style: Quicksand ships no italic face, so each platform fakes it
  // differently and `core/font.ts` is what knows how. Setting the spec by hand rendered the
  // sentence upright on the phone while every card title beside it slanted -- which lost the
  // whole point of putting it here.

  if (lead) {
    return (
      <View style={styles.block}>
        <InkTitle level={1}>{lead.summary}</InkTitle>
        <InkText size="sm" tone="secondary">{t('proposals.card.why', { rationale: lead.rationale })}</InkText>
        <View style={styles.actions}>
          <InkButton variant="quiet" disabled={deciding !== null} onPress={() => onDecline(lead.id)}>
            {t('proposals.card.decline')}
          </InkButton>
          <InkButton
            variant="primary"
            loading={deciding === lead.id}
            disabled={deciding !== null}
            onPress={() => onAccept(lead.id)}
          >
            {t('proposals.card.accept')}
          </InkButton>
        </View>
      </View>
    );
  }

  if (reminderCount > 0) {
    return (
      <GPressable
        style={styles.block}
        accessibilityRole="button"
        onPress={() => {
          void selectionTick();
          router.push('/(stack)/reminders');
        }}
      >
        <InkTitle level={1}>{t('home.saysReminders', { count: reminderCount })}</InkTitle>
      </GPressable>
    );
  }

  return (
    <View style={styles.block}>
      <InkTitle level={1}>{t('home.saysQuiet')}</InkTitle>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useInkTheme>) =>
  StyleSheet.create({
    block: { gap: theme.space[2], marginBottom: theme.space[5] },
    // Against the right edge, where the thumb is, and after the reason rather than beside it:
    // a yes should follow the sentence it answers.
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.space[2], marginTop: theme.space[1] },
  });
