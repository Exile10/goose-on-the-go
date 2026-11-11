/**
 * To-dos and reminders: what Goose is asking about, the mentions from chats it offers to add, then
 * the open list in the order things come up, or what is done. The places a to-do can wait on are
 * kept at the foot.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkEmptyState, InkSegmented, InkSpinner, InkText, useInkTheme } from '@jarida/ink/native';

import { RoundButton, ScreenScroll, SectionHead } from '@/components/goose/hub-parts';
import { PlacesList, SavePlaceHere } from '@/components/goose/places';
import { CheckinRow, LocationSheet, OfferRow, TodoRow, openTodo } from '@/components/goose/todo-parts';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { Spacing } from '@/constants/spacing';
import { isUnavailable } from '@/models/content-state';
import { selectionTick } from '@/services/haptics';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { useTodos } from '@/view-models/use-todos';

type Showing = 'open' | 'done';

export default function GooseTodosScreen() {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const todos = useTodos();
  const pull = usePullToRefresh(todos.actions.reload);
  const [showing, setShowing] = useState<Showing>('open');
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const { asking, upcoming, offers, done } = todos.data;
  const state = useContentState({ loading: todos.loading, failed: todos.failed, hasContent: todos.data.open.length + done.length + offers.length > 0 });
  const run = async (id: string, work: () => Promise<unknown>) => {
    setBusy(id);
    await work();
    setBusy(null);
  };
  const divided = (i: number) => (i > 0 ? [styles.divided, { borderTopColor: theme.color.line }] : null);

  return (
    <ScreenScroll pull={pull}>
      <SectionHead title={t('goose.todos.title')} subtitle={t('goose.todos.screenSubtitle')} trailing={<RoundButton icon="plus" label={t('goose.todos.add')} onPress={() => openTodo(null)} />} />
      <InkSegmented
        label={t('goose.todos.showing')}
        value={showing}
        options={[
          { value: 'open', label: t('goose.todos.open', { count: todos.data.open.length }) },
          { value: 'done', label: t('goose.todos.doneTab', { count: done.length }) },
        ]}
        onChange={(v) => {
          void selectionTick();
          setShowing(v);
        }}
      />
      {state === 'loading' ? <InkSpinner label={t('goose.todos.loading')} /> : null}
      {isUnavailable(state) ? <ContentUnavailable state={state} reason={todos.error} onRetry={todos.actions.reload} /> : null}

      {showing === 'open' ? (
        <>
          {asking.length ? (
            <View style={styles.section}>
              <SectionHead title={t('goose.asking.title')} size="small" />
              <InkCard contentStyle={styles.card}>
                {asking.map((todo, i) => (
                  <View key={todo.id} style={divided(i)}>
                    <CheckinRow
                      todo={todo}
                      busy={busy === todo.id}
                      onDone={() => void run(todo.id, () => todos.actions.answer(todo, 'done'))}
                      onNotYet={() => void run(todo.id, () => todos.actions.answer(todo, 'not_yet'))}
                    />
                  </View>
                ))}
              </InkCard>
            </View>
          ) : null}
          {offers.length ? (
            <View style={styles.section}>
              <SectionHead title={t('goose.offers.title')} subtitle={t('goose.offers.subtitle')} size="small" />
              <InkCard contentStyle={styles.card}>
                {offers.map((offer, i) => (
                  <View key={offer.reminderId} style={divided(i)}>
                    <OfferRow
                      offer={offer}
                      busy={busy === offer.reminderId}
                      onAdd={(dueAt) => void run(offer.reminderId, () => todos.actions.acceptOffer(offer, dueAt))}
                      onNo={() => void run(offer.reminderId, () => todos.actions.declineOffer(offer))}
                    />
                  </View>
                ))}
              </InkCard>
            </View>
          ) : null}
          {upcoming.length ? (
            <View>
              {upcoming.map((todo, i) => (
                <View key={todo.id} style={divided(i)}>
                  <TodoRow todo={todo} sources={todos.sources} access={todos.access} onToggle={() => void todos.actions.setDone(todo, true)} onNeedsLocation={() => setSheet(true)} />
                </View>
              ))}
            </View>
          ) : state === 'empty' || (!todos.loading && asking.length + offers.length === 0) ? (
            <InkEmptyState
              icon="checklist"
              title={t('goose.todos.emptyTitle')}
              action={
                <InkButton variant="primary" icon="plus" onPress={() => openTodo(null)}>
                  {t('goose.todos.add')}
                </InkButton>
              }
            >
              <InkText tone="secondary">{t('goose.todos.emptyBody')}</InkText>
            </InkEmptyState>
          ) : null}
        </>
      ) : done.length ? (
        <View>
          {done.map((todo, i) => (
            <View key={todo.id} style={divided(i)}>
              <TodoRow todo={todo} sources={todos.sources} access={todos.access} onToggle={() => void todos.actions.setDone(todo, false)} />
            </View>
          ))}
        </View>
      ) : (
        <InkText tone="secondary">{t('goose.todos.noneDone')}</InkText>
      )}

      <View style={styles.section}>
        <SectionHead title={t('goose.places.title')} subtitle={t('goose.places.subtitle')} size="small" />
        <PlacesList places={todos.sources.places} onRemove={(id) => void todos.actions.removePlace(id)} />
        <SavePlaceHere onSave={todos.actions.addPlaceHere} />
        {todos.access && todos.access !== 'granted' ? (
          <InkButton variant="quiet" icon="locate" onPress={() => setSheet(true)} style={styles.left}>
            {t('goose.places.allowFromList')}
          </InkButton>
        ) : null}
      </View>
      <LocationSheet open={sheet} access={todos.access} onClose={() => setSheet(false)} onAllow={todos.actions.allowLocation} />
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.sm },
  card: { paddingVertical: Spacing.xs, gap: 0 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth },
  left: { alignSelf: 'flex-start' },
});
