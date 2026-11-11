/**
 * The older My Goose, for a Pond without `/me/hub`: what the Goose is holding for this member, read
 * from the routes the Pond already had. It opens on one sentence that says what needs them, then a
 * shelf for each kind of thing with something true on it. Shelves with nothing on them fold into a
 * short list of what the Goose could do instead. Unchanged from before the hub.
 */

import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InkNotice, InkSpinner, InkTitle } from '@jarida/ink/native';

import { Goose } from '@/components/patterns/goose';
import {
  BriefCard,
  CartRow,
  GlyphRow,
  GooseSentence,
  OfferCard,
  ShelfHeader,
  WatchShelf,
} from '@/components/patterns/goose-shelves';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { GooseClause, GooseShelf } from '@/models/my-goose';
import type { WebWatch } from '@/models/web-watches';
import { useBottomBarInset, useChromeScroll } from '@/providers/chrome-provider';
import { selectionTick } from '@/services/haptics';
import { useOlderMyGoose } from '@/view-models/use-my-goose';
import type { OfferedPrompt } from '@/view-models/use-suggestions';

/** Where each shelf's own screen is. */
const SHELF_ROUTE: Record<GooseShelf, string> = {
  offers: '/(stack)/suggestions',
  watching: '/(stack)/web-watches',
  news: '/(stack)/goose-news',
  reminders: '/(stack)/reminders',
  cart: '/(stack)/goose-cart',
  ideas: '/(stack)/goose-ideas',
};

/** Shelves shown on the tab before their See all. */
const SHOWN = { watches: 6, carts: 2, prompts: 3 } as const;

function go(href: string) {
  void selectionTick();
  router.push(href as never);
}

export function OlderMyGoose() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const chrome = useChromeScroll();
  const bottomInset = useBottomBarInset();
  const { data, loading, failed, deciding, startingNews, actions } = useOlderMyGoose();
  const [pulling, setPulling] = useState(false);

  const onPull = useCallback(async () => {
    setPulling(true);
    try {
      await actions.refresh();
    } finally {
      setPulling(false);
    }
  }, [actions]);

  const openClause = (clause: GooseClause) => go(SHELF_ROUTE[clause.shelf]);
  const openWatch = (watch: WebWatch) => {
    void selectionTick();
    router.push({ pathname: '/(stack)/web-watch', params: { id: watch.id } } as never);
  };
  const ask = (prompt: OfferedPrompt) => {
    void selectionTick();
    actions.taken(prompt);
    router.push({ pathname: '/conversation', params: { ask: prompt.prompt } } as never);
  };

  const [offer, ...moreOffers] = data.offers;
  const watches = [...data.hits, ...data.watches.filter((w) => !data.hits.includes(w))].slice(0, SHOWN.watches);
  const brief = data.briefs[0] ?? null;
  const anything = data.clauses.length > 0;
  const quiet =
    data.watches.length > 0 ? t('myGoose.quietWatching', { count: data.watches.length }) : t('myGoose.quiet');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        {...chrome}
        style={styles.page}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset + Spacing.xl }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}
      >
        <View style={styles.head}>
          <InkTitle level={1}>{t('myGoose.title')}</InkTitle>
          <Goose state={loading ? 'working' : 'idle'} size={60} water={false} />
        </View>

        {loading && !anything ? (
          <InkSpinner label={t('myGoose.loading')} />
        ) : (
          <GooseSentence clauses={data.clauses} quiet={quiet} onOpen={openClause} />
        )}

        {offer ? (
          <View style={styles.shelf}>
            <ShelfHeader title={t('myGoose.shelf.offers')} count={data.offers.length} onSeeAll={() => go(SHELF_ROUTE.offers)} />
            <OfferCard
              offer={offer}
              more={moreOffers.length}
              deciding={deciding === offer.id}
              onApprove={() => void actions.approve(offer.id)}
              onDecline={() => void actions.decline(offer.id)}
              onMore={() => go(SHELF_ROUTE.offers)}
            />
          </View>
        ) : null}
        {failed.offers ? <InkNotice tone="warning">{t('myGoose.shelf.unavailable')}</InkNotice> : null}

        {watches.length > 0 ? (
          <View style={styles.shelf}>
            <ShelfHeader title={t('myGoose.shelf.watching')} count={data.watches.length} onSeeAll={() => go(SHELF_ROUTE.watching)} />
            <WatchShelf watches={watches} onOpen={openWatch} />
          </View>
        ) : null}

        {brief ? (
          <View style={styles.shelf}>
            <ShelfHeader title={t('myGoose.shelf.news')} count={data.briefs.length} onSeeAll={() => go(SHELF_ROUTE.news)} />
            <BriefCard brief={brief} onPress={() => go(SHELF_ROUTE.news)} />
          </View>
        ) : null}

        {data.carts.length > 0 ? (
          <View style={styles.shelf}>
            <ShelfHeader title={t('myGoose.shelf.cart')} count={data.kept} onSeeAll={() => go(SHELF_ROUTE.cart)} />
            {data.carts.slice(0, SHOWN.carts).map((cart) => (
              <CartRow key={cart.name ?? ''} cart={cart} onPress={() => go(SHELF_ROUTE.cart)} />
            ))}
          </View>
        ) : null}

        {data.prompts.length > 0 || data.agentIdeas.length > 0 || data.reminders.length > 0 ? (
          <View style={styles.shelf}>
            <ShelfHeader title={t('myGoose.shelf.ideas')} onSeeAll={() => go(SHELF_ROUTE.ideas)} />
            <View>
              {data.prompts.slice(0, SHOWN.prompts).map((p) => (
                <GlyphRow
                  key={p.id ?? p.prompt}
                  icon="chat"
                  title={p.prompt}
                  detail={p.because}
                  onPress={() => ask(p)}
                  accessibilityLabel={t('myGoose.ideas.askLabel', { prompt: p.prompt })}
                />
              ))}
              {data.agentIdeas[0] ? (
                <GlyphRow
                  icon="agent"
                  title={data.agentIdeas[0].title}
                  detail={data.agentIdeas[0].activations_summary}
                  onPress={() => go(SHELF_ROUTE.ideas)}
                />
              ) : null}
              {data.reminders.length > 0 ? (
                <GlyphRow
                  icon="alarm"
                  title={t('myGoose.ideas.reminders', { count: data.reminders.length })}
                  detail={data.reminders[0].text}
                  onPress={() => go(SHELF_ROUTE.reminders)}
                />
              ) : null}
            </View>
          </View>
        ) : null}

        {!loading && (watches.length === 0 || !brief || data.carts.length === 0) ? (
          <View style={styles.shelf}>
            <ShelfHeader title={t('myGoose.try.title')} />
            <View>
              {!brief && !failed.news ? (
                <GlyphRow
                  icon="file-text"
                  title={data.asking > 0 ? t('myGoose.news.waiting') : t('myGoose.try.news')}
                  detail={startingNews ? undefined : data.asking > 0 ? undefined : t('myGoose.news.start')}
                  onPress={() => go(SHELF_ROUTE.news)}
                />
              ) : null}
              {watches.length === 0 && !failed.watches ? (
                <GlyphRow icon="eye" title={t('myGoose.try.watching')} detail={t('myGoose.try.startChat')} onPress={() => go('/conversation')} />
              ) : null}
              {data.carts.length === 0 && !failed.cart ? (
                <GlyphRow icon="package" title={t('myGoose.try.cart')} detail={t('myGoose.try.startChat')} onPress={() => go('/conversation')} />
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    page: { flex: 1 },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.xl },
    head: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: -Spacing.md },
    shelf: { gap: Spacing.md },
  });
