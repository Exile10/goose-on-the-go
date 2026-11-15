/**
 * One idea's own page: what it is, the facts at a glance, why it fits, the steps, what Goose kept
 * to work from, and where it came from. From here Goose takes its part, the steps become to-dos,
 * or the idea goes to chat with Goose's notes on it.
 */

import React from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkEmptyState, InkSpinner } from '@/components/ui/ink';

import { ScreenScroll } from '@/components/goose/hub-parts';
import { IdeaPanel } from '@/components/goose/idea-card';
import { cardParams } from '@/models/cards';
import { useIdea } from '@/view-models/use-ideas';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

export default function GooseIdeaScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { idea, ideas } = useIdea(id);
  const pull = usePullToRefresh(ideas.reload);
  return (
    <ScreenScroll pull={pull}>
      {!idea && ideas.loading ? <InkSpinner label={t('goose.ideas.loading')} /> : null}
      {!idea && !ideas.loading ? <InkEmptyState icon="light" title={t('goose.ideas.missing')} /> : null}
      {idea ? (
        <IdeaPanel
          idea={idea}
          busy={ideas.busy === idea.id}
          made={ideas.made[idea.id]}
          onGoose={() => void ideas.actions.gooseDoIt(idea)}
          onMine={() => void ideas.actions.illDoIt(idea)}
          onDismiss={() => {
            void ideas.actions.dismiss(idea);
            router.back();
          }}
          onChat={() => router.push({ pathname: '/conversation', params: cardParams({ kind: 'idea', id: idea.id, title: idea.title }) })}
        />
      ) : null}
    </ScreenScroll>
  );
}
