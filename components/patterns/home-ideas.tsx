/**
 * HomeIdeas — the prompts the Pond offers, and the way through to what it has not said yet.
 *
 * The one proposal Home states is the sentence at the top (`PondSays`); this is what is left:
 * things worth asking, composed by the Pond from its memories, and a link to any proposals
 * waiting behind the one on show.
 *
 * Only prompts carrying a Pond id appear. `useSuggestions` keeps the fixed starters on screen
 * when the Pond has none, which is right in a conversation about to be started and wrong here --
 * the same three chips every day would be chrome, and would stop this ever being absent.
 *
 * Reminders are a line and never a card with a dismiss: dismissal is final, the Pond has no route
 * that brings one back, and the asking belongs on the screen that already asks. They appear here
 * only when the sentence above is not already carrying them.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkChip, InkText, InkTitle, useInkTheme } from '@jarida/ink/native';

import { GPressable } from '@/components/ui/g-pressable';
import { selectionTick } from '@/services/haptics';
import { useHomeIdeas, type PondPrompt } from '@/view-models/use-home-ideas';

export function HomeIdeas() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useInkTheme();
  const styles = makeStyles(theme);
  const { data, actions } = useHomeIdeas();

  // The sentence at the top states a proposal when there is one, and carries the reminders when
  // there is not. This draws the reminders line only in the case it does not.
  const showReminders = data.reminderCount > 0 && data.lead !== null;

  if (data.prompts.length === 0 && data.rest === 0 && !showReminders) return null;

  const ask = (prompt: PondPrompt) => {
    void selectionTick();
    actions.taken(prompt);
    router.push({ pathname: '/conversation', params: { ask: prompt.prompt } });
  };

  return (
    <View style={styles.block}>
      {data.prompts.length > 0 ? (
        <>
          <InkTitle level={3}>{t('home.ideasAsk')}</InkTitle>
          <View style={styles.chips}>
            {data.prompts.map((prompt) => (
              <InkChip key={prompt.id} onPress={() => ask(prompt)}>
                {prompt.prompt}
              </InkChip>
            ))}
          </View>
        </>
      ) : null}

      {data.rest > 0 ? (
        <GPressable
          hitSlop={12}
          accessibilityRole="button"
          onPress={() => {
            void selectionTick();
            router.push('/(stack)/suggestions');
          }}
        >
          <InkText size="sm" tone="secondary">{t('home.ideasSeeAll', { count: data.rest })}</InkText>
        </GPressable>
      ) : null}

      {showReminders ? (
        <GPressable
          hitSlop={12}
          accessibilityRole="button"
          onPress={() => {
            void selectionTick();
            router.push('/(stack)/reminders');
          }}
        >
          <InkText size="sm" tone="secondary">
            {t('home.remindersWaiting', { count: data.reminderCount })}
          </InkText>
        </GPressable>
      ) : null}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useInkTheme>) =>
  StyleSheet.create({
    block: { gap: theme.space[2], marginBottom: theme.space[5] },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] },
  });
