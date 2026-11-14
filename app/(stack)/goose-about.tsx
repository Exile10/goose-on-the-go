/**
 * About you: what the Pond remembers about the member, heading by heading. One of their own facts
 * opens a sheet to reword it, file it under another word or delete it; a household fact is shown
 * and is not theirs to change.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkEmptyState, InkSpinner, InkText } from '@jarida/ink/native';

import { FactSheet, ListSection, SentenceRow, shortDate } from '@/components/goose/about-parts';
import { GroupRow, InsetGroup } from '@/components/goose/following';
import { ScreenScroll } from '@/components/goose/hub-parts';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { Spacing } from '@/constants/spacing';
import { factCount, wordLabel, type AboutFact } from '@/models/about';
import { isUnavailable } from '@/models/content-state';
import { useAbout } from '@/view-models/use-about';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

export default function GooseAboutScreen() {
  const { t, i18n } = useTranslation();
  const about = useAbout();
  const pull = usePullToRefresh(about.actions.reload);
  // The fact stays after closing, so the sheet leaves with its own title on it.
  const [sheet, setSheet] = useState<{ open: boolean; fact: AboutFact | null; opening: number }>({ open: false, fact: null, opening: 0 });
  const { profile, setAside } = about;
  const state = useContentState({ loading: about.loading, failed: about.failed, hasContent: factCount(profile) > 0 });
  const open = (fact: AboutFact | null) => setSheet((s) => ({ open: true, fact, opening: s.opening + 1 }));

  const detail = (fact: AboutFact) =>
    [
      fact.shared ? t('goose.about.shared') : null,
      fact.sensitive ? t('goose.about.sensitive') : null,
      fact.expiresAt ? t('goose.about.expires', { date: shortDate(fact.expiresAt, i18n.language) }) : null,
    ]
      .filter(Boolean)
      .join(' · ') || null;

  const spoken = (fact: AboutFact) =>
    [
      t('goose.about.factLabel', { content: fact.content.replace(/[.!?\s]+$/, ''), word: fact.about ? wordLabel(fact.about) : t('goose.about.other') }),
      detail(fact),
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <ScreenScroll pull={pull} gap={Spacing.xl}>
      <View style={styles.lead}>
        <InkText tone="secondary">{t('goose.about.lead')}</InkText>
        {state === 'ready' ? (
          <InkButton variant="quiet" icon="plus" onPress={() => open(null)} style={styles.left}>
            {t('goose.about.add')}
          </InkButton>
        ) : null}
      </View>
      {state === 'loading' ? <InkSpinner label={t('goose.about.loading')} /> : null}
      {isUnavailable(state) ? <ContentUnavailable state={state} reason={about.error} onRetry={about.actions.reload} /> : null}
      {state === 'empty' ? (
        <InkEmptyState
          icon="profile"
          title={t('goose.about.emptyTitle')}
          action={
            <View style={styles.actions}>
              <InkButton variant="primary" onPress={() => router.push('/(stack)/goose-member-interview')}>
                {t('goose.about.takeInterview')}
              </InkButton>
              <InkButton variant="quiet" icon="plus" onPress={() => open(null)}>
                {t('goose.about.add')}
              </InkButton>
            </View>
          }
        >
          <InkText tone="secondary">{t('goose.about.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}

      {profile.headings.map((heading) => (
        <ListSection key={heading.heading} title={heading.segment === 'other' ? t('goose.about.other') : heading.heading}>
          <InsetGroup>
            {heading.facts.map((fact, i) => (
              <SentenceRow
                key={fact.id}
                first={i === 0}
                text={fact.content}
                detail={detail(fact)}
                label={spoken(fact)}
                onPress={fact.shared ? undefined : () => open(fact)}
              />
            ))}
          </InsetGroup>
        </ListSection>
      ))}

      {profile.toFile > 0 ? (
        <InkText size="sm" tone="tertiary">
          {t('goose.about.toFile', { count: profile.toFile })}
        </InkText>
      ) : null}
      {setAside > 0 ? (
        <InsetGroup>
          <GroupRow first icon="archive" label={t('goose.about.archivedLink', { count: setAside })} onPress={() => router.push('/(stack)/goose-about-archived')} />
        </InsetGroup>
      ) : null}

      <FactSheet
        open={sheet.open}
        fact={sheet.fact}
        opening={sheet.opening}
        words={profile.words}
        onClose={() => setSheet((s) => ({ ...s, open: false }))}
        onAdd={about.actions.add}
        onEdit={about.actions.edit}
        onDelete={about.actions.remove}
      />
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  lead: { gap: Spacing.sm },
  left: { alignSelf: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.sm },
});
