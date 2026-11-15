/**
 * Set aside: the older memories a re-sort took out of the profile, each with its reason, and a way
 * to bring any of them back.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { InkButton, InkEmptyState, InkSpinner, InkText } from '@/components/ui/ink';

import { SentenceRow } from '@/components/goose/about-parts';
import { InsetGroup } from '@/components/goose/following';
import { ScreenScroll } from '@/components/goose/hub-parts';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { Spacing } from '@/constants/spacing';
import { isUnavailable } from '@/models/content-state';
import { useArchivedAbout } from '@/view-models/use-about';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

export default function GooseAboutArchivedScreen() {
  const { t } = useTranslation();
  const archived = useArchivedAbout();
  const pull = usePullToRefresh(archived.actions.reload);
  const facts = archived.data;
  const state = useContentState({ loading: archived.loading, failed: archived.failed, hasContent: facts.length > 0 });

  return (
    <ScreenScroll pull={pull} gap={Spacing.xl}>
      <InkText tone="secondary">{t('goose.about.archivedLead')}</InkText>
      {state === 'loading' ? <InkSpinner label={t('goose.about.loading')} /> : null}
      {isUnavailable(state) ? <ContentUnavailable state={state} reason={archived.error} onRetry={archived.actions.reload} /> : null}
      {state === 'empty' ? <InkEmptyState icon="archive" title={t('goose.about.archivedEmpty')} /> : null}
      {facts.length ? (
        <InsetGroup>
          {facts.map((fact, i) => (
            <SentenceRow
              key={fact.id}
              first={i === 0}
              text={fact.content}
              detail={fact.why ? t('goose.about.why', { why: fact.why }) : null}
              // The reason is why the row is here; cut short it says nothing.
              detailLines={2}
              trailing={
                <InkButton variant="quiet" size="sm" onPress={() => void archived.actions.restore(fact)}>
                  {t('goose.about.restore')}
                </InkButton>
              }
            />
          ))}
        </InsetGroup>
      ) : null}
    </ScreenScroll>
  );
}
