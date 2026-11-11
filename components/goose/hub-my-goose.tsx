/**
 * My Goose as the hub, for a Pond that serves `/me/hub`. It is ordered by what needs the member:
 * the sentence, then what Goose is asking, then the news written for them, then what Goose found
 * (ideas, prices, long reads), then the to-dos, the watches, what is connected and what else Goose
 * can do, and at the foot what the member keeps and follows. A section with nothing in it folds
 * away or becomes an invitation; nothing is drawn as an empty box.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InkButton, InkCard, InkSpinner, InkText, inkText, useInkTheme } from '@jarida/ink/native';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { GlyphRow, WatchShelf } from '@/components/patterns/goose-shelves';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { ThemeColors } from '@/constants/colors';
import { iconOr } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { catalogHref, type CatalogItem } from '@/models/catalog';
import { inUse } from '@/models/connectors';
import type { MeHub } from '@/models/hub';
import { shownIdeas } from '@/models/ideas';
import { categoriesOf, categoryIcon, categoryKey } from '@/models/interests';
import { formatMoney } from '@/models/me-read';
import type { HubClause } from '@/models/my-goose';
import { formatPrice } from '@/models/my-goose';
import { splitStories } from '@/models/news';
import type { WebWatch } from '@/models/web-watches';
import { useBottomBarInset, useChromeScroll } from '@/providers/chrome-provider';
import { selectionTick, tap } from '@/services/haptics';
import { Storage } from '@/services/storage';
import { useContentState } from '@/view-models/use-content-state';
import { useMyGooseHub, type UseMyGooseHub } from '@/view-models/use-my-goose';
import { useListen, useStoryActions } from '@/view-models/use-news';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { usePriceWords } from './cart-parts';
import { DigestCard } from './digest-card';
import { Carousel, PortraitCard } from './featured';
import { GroupHeading, GroupRow, InsetGroup } from './following';
import { MoreLink, RoundButton, SectionHead, useAgo } from './hub-parts';
import { HubSentence } from './hub-sentence';
import { IdeaPortrait } from './idea-card';
import { InterestsGroup } from './interests-group';
import { ConnectorStrip } from './connector-strip';
import { CompactStory, HeroStory, LongReadShelf } from './news-cards';
import { CheckinRow, LocationSheet, OfferRow, TodoRow, openTodo } from './todo-parts';

function go(href: Parameters<typeof router.push>[0]) {
  void selectionTick();
  router.push(href);
}

/** How many compact stories follow the hero on the tab. */
const COMPACT_STORIES = 3;
const SHOWN_TODOS = 4;

function targetHref(clause: HubClause): Parameters<typeof router.push>[0] {
  const target = clause.target;
  switch (target.to) {
    case 'todos':
      return '/(stack)/goose-todos';
    case 'interview':
      return '/(stack)/goose-interview';
    case 'news':
      return '/(stack)/goose-news';
    case 'digest':
      return { pathname: '/(stack)/goose-digest', params: { id: target.id } };
    case 'cart':
      return { pathname: '/(stack)/goose-cart-item', params: { id: target.id } };
    case 'ideas':
      return '/(stack)/goose-ideas';
  }
}

function Header() {
  const theme = useInkTheme();
  const { t, i18n } = useTranslation();
  const title = inkText(theme, { role: 'display', size: '3xl', weight: 700, tracking: 'title', color: theme.color.text }).style;
  const today = new Date().toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <View>
      <Text style={title} accessibilityRole="header">
        {t('myGoose.title')}
      </Text>
      <InkText size="lg" weight="semibold" tone="secondary">
        {today}
      </InkText>
    </View>
  );
}

function InterviewInvite() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  return (
    <InkCard>
      <View style={styles.invite}>
        <InkText size="xl" weight="bold">
          {t('goose.invite.title')}
        </InkText>
        <InkText size="md" tone="secondary">
          {t('goose.invite.body')}
        </InkText>
        <View style={styles.inviteActions}>
          <InkButton variant="primary" icon="chat" onPress={() => go('/(stack)/goose-interview')}>
            {t('goose.invite.start')}
          </InkButton>
          <InkButton variant="quiet" icon="plus" onPress={() => go('/(stack)/goose-interests')}>
            {t('goose.invite.addOne')}
          </InkButton>
        </View>
      </View>
    </InkCard>
  );
}

function Asking({ g }: { g: UseMyGooseHub }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const theme = useInkTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const { asking, offers } = g.todos.data;
  if (asking.length + offers.length === 0) return null;
  const run = async (id: string, work: () => Promise<unknown>) => {
    setBusy(id);
    await work();
    setBusy(null);
  };
  return (
    <View style={styles.section}>
      <SectionHead title={t('goose.asking.title')} subtitle={t('goose.asking.subtitle')} />
      <InkCard contentStyle={styles.askCard}>
        {asking.map((todo, i) => (
          <View key={todo.id} style={i > 0 ? [styles.divided, { borderTopColor: theme.color.line }] : null}>
            <CheckinRow
              todo={todo}
              busy={busy === todo.id}
              onDone={() => void run(todo.id, () => g.todos.actions.answer(todo, 'done'))}
              onNotYet={() => void run(todo.id, () => g.todos.actions.answer(todo, 'not_yet'))}
            />
          </View>
        ))}
        {offers.map((offer, i) => (
          <View key={offer.reminderId} style={asking.length + i > 0 ? [styles.divided, { borderTopColor: theme.color.line }] : null}>
            <OfferRow
              offer={offer}
              busy={busy === offer.reminderId}
              onAdd={(dueAt) => void run(offer.reminderId, () => g.todos.actions.acceptOffer(offer, dueAt))}
              onNo={() => void run(offer.reminderId, () => g.todos.actions.declineOffer(offer))}
            />
          </View>
        ))}
      </InkCard>
    </View>
  );
}

function News({ g }: { g: UseMyGooseHub }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const ago = useAgo();
  const actions = useStoryActions();
  const listen = useListen();
  const { data, loading } = g.news;
  const followed = useMemo(() => new Map(g.interests.data.map((i) => [i.id, i.news !== 'off'])), [g.interests.data]);
  const { news } = splitStories(data.stories);
  const [hero, ...rest] = news;
  const digest = data.digest;

  if (loading && news.length === 0 && !digest) return null;

  const blocked =
    data.blocked === 'web_search' ? (
      <InkCard>
        <View style={styles.invite}>
          <InkText size="lg" weight="bold">
            {t('goose.news.blockedSearchTitle')}
          </InkText>
          <InkText tone="secondary">{t('goose.news.blockedSearchBody')}</InkText>
          <InkButton variant="primary" icon="globe" onPress={() => go('/(stack)/goose-connectors')} style={styles.start}>
            {t('goose.news.blockedSearchAction')}
          </InkButton>
        </View>
      </InkCard>
    ) : null;

  // A new member is already invited at the top; the news says nothing more until there is some.
  if (!hero && !digest && !blocked) {
    if (data.state !== 'writing') return null;
    return (
      <View style={styles.section}>
        <SectionHead title={t('goose.news.title')} />
        <InkSpinner label={t('goose.news.writingFirst')} />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHead
        fact={data.state === 'writing' ? t('goose.news.writingNow') : data.lastWrittenAt ? t('goose.news.updated', { when: ago(data.lastWrittenAt) }) : null}
        title={t('goose.news.title')}
        subtitle={t('goose.news.subtitle')}
        onOpen={() => go('/(stack)/goose-news')}
        openLabel={t('goose.news.openAll')}
        trailing={<RoundButton icon="sliders" label={t('goose.newsSettings.title')} onPress={() => go('/(stack)/goose-news-settings')} />}
      />
      {blocked}
      {hero ? <HeroStory story={hero} actions={actions} followed={hero.interest ? (followed.get(hero.interest.id) ?? null) : null} /> : null}
      {rest.slice(0, COMPACT_STORIES).map((story) => (
        <CompactStory key={story.id} story={story} actions={actions} followed={story.interest ? (followed.get(story.interest.id) ?? null) : null} />
      ))}
      {digest ? (
        <DigestCard digest={digest} listen={listen.state} onPlay={() => digest.listen && void listen.play(digest.listen)} onStop={listen.stop} />
      ) : null}
      {news.length > COMPACT_STORIES + 1 || digest ? <MoreLink label={t('goose.news.more')} onPress={() => router.push('/(stack)/goose-news')} /> : null}
    </View>
  );
}

function Ideas({ g }: { g: UseMyGooseHub }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  // New ideas lead here: the ones Goose is already working on can wait their turn.
  const ideas = shownIdeas(g.ideas.data.ideas)
    .filter((i) => i.state !== 'done' || g.ideas.made[i.id])
    .sort((a, b) => Number(b.state === 'new') - Number(a.state === 'new'));
  if (ideas.length === 0) return null;
  const fresh = ideas.filter((i) => i.state === 'new').length;
  return (
    <View style={styles.section}>
      <SectionHead
        fact={fresh ? t('goose.ideas.fresh', { count: fresh }) : null}
        title={t('goose.ideas.title')}
        subtitle={t('goose.ideas.subtitle')}
        onOpen={() => go('/(stack)/goose-ideas')}
      />
      <Carousel>
        {ideas.map((idea) => (
          <IdeaPortrait
            key={idea.id}
            idea={idea}
            busy={g.ideas.busy === idea.id}
            made={g.ideas.made[idea.id]}
            onGoose={() => void g.ideas.actions.gooseDoIt(idea)}
            onMine={() => void g.ideas.actions.illDoIt(idea)}
            onOpen={() => go('/(stack)/goose-ideas')}
          />
        ))}
      </Carousel>
      <MoreLink label={t('goose.ideas.more')} onPress={() => router.push('/(stack)/goose-ideas')} />
    </View>
  );
}

function Prices({ g }: { g: UseMyGooseHub }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const words = usePriceWords();
  const items = g.cart.data;
  const kept = g.cart.kept;
  if (items.length === 0 && kept.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHead
        fact={items.length ? t('goose.cart.onWatch', { count: items.length }) : null}
        title={t('goose.cart.title')}
        subtitle={t('goose.cart.subtitle')}
        onOpen={() => go('/(stack)/goose-cart')}
      />
      {items.length ? (
        <Carousel>
          {items.map((item) => {
            const moved = words(item);
            return (
              <PortraitCard
                key={item.id}
                band={item.site}
                bandIcon="tag"
                picture={item.picture}
                pictureIcon="cart"
                title={item.title}
                meta={[item.price ? formatMoney(item.price) : t('goose.cart.noPrice'), moved?.text].filter(Boolean).join(', ')}
                metaIcon={moved?.tone === 'warn' ? 'warn' : moved?.tone === 'good' ? 'trending-down' : 'tag'}
                metaTone={moved?.tone ?? null}
                onPress={() => go({ pathname: '/(stack)/goose-cart-item', params: { id: item.id } })}
              />
            );
          })}
        </Carousel>
      ) : null}
      {kept.length ? (
        <InsetGroup>
          {kept.slice(0, 3).map((cart, i) => (
            <GroupRow
              key={cart.name ?? ''}
              first={i === 0}
              icon="package"
              label={cart.name ?? t('myGoose.cart.loose')}
              detail={t('goose.cart.keptListings', { count: cart.lines.length })}
              value={cart.low ? formatPrice(cart.low) : null}
              onPress={() => go('/(stack)/goose-cart')}
            />
          ))}
        </InsetGroup>
      ) : null}
      <MoreLink label={t('goose.cart.more')} onPress={() => router.push('/(stack)/goose-cart')} />
    </View>
  );
}

function LongReads({ g }: { g: UseMyGooseHub }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const { longReads } = splitStories(g.news.data.stories);
  if (longReads.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHead title={t('goose.news.longReads')} subtitle={t('goose.news.longReadsSubtitle')} />
      <LongReadShelf stories={longReads} />
    </View>
  );
}

function Todos({ g, onNeedsLocation }: { g: UseMyGooseHub; onNeedsLocation: () => void }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const theme = useInkTheme();
  const { upcoming } = g.todos.data;
  if (g.todos.loading && upcoming.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHead
        title={t('goose.todos.title')}
        subtitle={upcoming.length ? t('goose.todos.subtitle', { count: upcoming.length }) : null}
        onOpen={() => go('/(stack)/goose-todos')}
        trailing={<RoundButton icon="plus" label={t('goose.todos.add')} onPress={() => openTodo(null)} />}
      />
      {upcoming.length === 0 ? (
        <GPressable onPress={() => openTodo(null)} accessibilityRole="button" accessibilityLabel={t('goose.todos.emptyAction')} style={styles.emptyRow}>
          <GIcon name="plus" size={18} color={theme.color.accentLine} />
          <InkText size="md" tone="secondary" style={{ flex: 1 }}>
            {t('goose.todos.emptyHub')}
          </InkText>
        </GPressable>
      ) : (
        <View>
          {upcoming.slice(0, SHOWN_TODOS).map((todo, i) => (
            <View key={todo.id} style={i > 0 ? [styles.divided, { borderTopColor: theme.color.line }] : null}>
              <TodoRow todo={todo} sources={g.todos.sources} access={g.todos.access} onToggle={() => void g.todos.actions.setDone(todo, true)} onNeedsLocation={onNeedsLocation} />
            </View>
          ))}
          {upcoming.length > SHOWN_TODOS ? <MoreLink label={t('goose.todos.more', { count: upcoming.length - SHOWN_TODOS })} onPress={() => router.push('/(stack)/goose-todos')} /> : null}
        </View>
      )}
    </View>
  );
}

function Watching({ g }: { g: UseMyGooseHub }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const watches = g.watches.data.watches;
  if (watches.length === 0) return null;
  const open = (w: WebWatch) => go({ pathname: '/(stack)/web-watch', params: { id: w.id } });
  const ordered = [...watches].sort((a, b) => b.matchingCount - a.matchingCount);
  return (
    <View style={styles.section}>
      <SectionHead title={t('goose.watching.title')} subtitle={t('goose.watching.subtitle')} onOpen={() => go('/(stack)/web-watches')} size="small" />
      <WatchShelf watches={ordered} onOpen={open} />
    </View>
  );
}

function Connectors({ g }: { g: UseMyGooseHub }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  if (!g.hub.connectors || (g.connectors.loading && g.connectors.data.length === 0)) return null;
  const used = inUse(g.connectors.data);
  return (
    <View style={styles.section}>
      <SectionHead title={t('goose.connectors.title')} subtitle={used.length ? null : t('goose.connectors.noneYet')} onOpen={() => go('/(stack)/goose-connectors')} size="small" />
      <ConnectorStrip connectors={used} />
    </View>
  );
}

function catalogDetail(item: CatalogItem, t: (k: 'goose.catalog.off' | 'goose.catalog.needsSetup') => string): string {
  if (item.state === 'needs_setup') return `${t('goose.catalog.needsSetup')}. ${item.body}`;
  if (item.state === 'off') return `${t('goose.catalog.off')}. ${item.body}`;
  return item.body;
}

export function openCatalogItem(item: CatalogItem) {
  if (item.opens) go(catalogHref(item.opens));
  else if (item.try) go({ pathname: '/conversation', params: { ask: item.try } });
}

function MoreGooseCanDo({ g }: { g: UseMyGooseHub }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const items = g.catalog.data.filter((i) => i.opens || i.try);
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHead title={t('goose.catalog.title')} onOpen={() => go('/(stack)/goose-catalog')} size="small" />
      <View>
        {items.slice(0, 4).map((item) => (
          <GlyphRow key={item.id} icon={iconOr(item.icon, 'sparkle')} title={item.title} detail={catalogDetail(item, t)} onPress={() => openCatalogItem(item)} />
        ))}
      </View>
    </View>
  );
}

type Folded = { interests?: boolean; sections?: boolean };

function Following({ g }: { g: UseMyGooseHub }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const theme = useInkTheme();
  const [editing, setEditing] = useState(false);
  const [folded, setFolded] = useState<Folded>({});
  useEffect(() => {
    void Storage.getJSON<Folded>('followingFolded').then((f) => f && setFolded(f));
  }, []);
  const fold = (key: keyof Folded) => {
    const next = { ...folded, [key]: !folded[key] };
    setFolded(next);
    void Storage.setJSON('followingFolded', next);
  };
  const { confirmed } = g.interests.groups;
  const sections = categoriesOf(confirmed);
  const title = inkText(theme, { role: 'display', size: '2xl', weight: 700, tracking: 'title', color: theme.color.text }).style;

  return (
    <View style={styles.section}>
      <View style={styles.followHead}>
        <View style={{ flex: 1 }}>
          <Text style={title} accessibilityRole="header">
            {t('goose.following.title')}
          </Text>
          <InkText size="md" weight="semibold" tone="secondary">
            {t('goose.following.subtitle')}
          </InkText>
        </View>
        {g.hub.interests && confirmed.length > 0 ? (
          <GPressable
            onPress={() => {
              void tap();
              setEditing((e) => !e);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: editing }}
            style={[styles.pill, { backgroundColor: editing ? theme.color.accent : theme.color.chrome, borderColor: editing ? theme.color.accent : theme.color.lineStrong }]}
          >
            <InkText size="md" weight="semibold" style={{ color: editing ? theme.color.textOnAccent : theme.color.text }}>
              {editing ? t('goose.following.done') : t('goose.following.edit')}
            </InkText>
          </GPressable>
        ) : null}
      </View>

      <InsetGroup>
        <GroupRow first icon="archive" label={t('goose.following.saved')} onPress={() => go('/(stack)/saved')} />
        <GroupRow icon="users" label={t('goose.following.shared')} onPress={() => go({ pathname: '/(stack)/saved', params: { shared: '1' } })} />
        <GroupRow icon="news" label={t('goose.following.savedStories')} onPress={() => go({ pathname: '/(stack)/saved', params: { collection: t('goose.saved.storiesCollection') } })} />
        {g.hub.news ? <GroupRow icon="schedule" label={t('goose.following.history')} onPress={() => go('/(stack)/goose-history')} /> : null}
      </InsetGroup>

      {g.hub.interests ? (
        <View style={styles.group}>
          <GroupHeading title={t('goose.following.interests')} folded={folded.interests} onToggle={() => fold('interests')} />
          {!folded.interests ? (
            <InterestsGroup interests={g.interests} editing={editing} onAdd={() => go({ pathname: '/(stack)/goose-interests', params: { add: '1' } })} />
          ) : null}
        </View>
      ) : null}

      {sections.length > 0 ? (
        <View style={styles.group}>
          <GroupHeading title={t('goose.following.sections')} folded={folded.sections} onToggle={() => fold('sections')} />
          {!folded.sections ? (
            <InsetGroup>
              {sections.map((s, i) => (
                <GroupRow
                  key={s.category}
                  first={i === 0}
                  icon={categoryIcon(s.category)}
                  label={t(categoryKey(s.category))}
                  detail={s.interests.map((x) => x.topic).join(', ')}
                  onPress={() => go({ pathname: '/(stack)/goose-section', params: { category: s.category } })}
                />
              ))}
            </InsetGroup>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function HubMyGoose({ hub }: { hub: MeHub }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const chrome = useChromeScroll();
  const bottomInset = useBottomBarInset();
  const g = useMyGooseHub(hub);
  const pull = usePullToRefresh(g.reload);
  const [placesSheet, setPlacesSheet] = useState(false);

  const clauses = g.clauses.map((clause) => ({
    text: t(clause.key as never, clause.params) as string,
    onPress: () => go(targetHref(clause)),
  }));

  const anything =
    g.news.data.stories.length + g.todos.data.open.length + g.todos.data.offers.length + g.cart.data.length + g.ideas.data.ideas.length + g.interests.data.length > 0 ||
    !!g.news.data.digest;
  const failed = g.news.failed && g.todos.failed && g.interests.failed;
  const state = useContentState({ loading: g.loading, failed, hasContent: anything });
  const reload = useCallback(() => g.reload(), [g]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        {...chrome}
        style={styles.page}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset + Spacing.xl }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pull} />}
      >
        <Header />
        {g.loading && !anything ? <InkSpinner label={t('myGoose.loading')} /> : <HubSentence clauses={clauses} quiet={t('goose.say.quiet')} />}
        {state === 'unreachable' || state === 'failed' ? <ContentUnavailable state={state} onRetry={reload} /> : null}
        {g.newMember ? <InterviewInvite /> : null}
        {hub.todos ? <Asking g={g} /> : null}
        {hub.news ? <News g={g} /> : null}
        {hub.ideas ? <Ideas g={g} /> : null}
        {hub.cart ? <Prices g={g} /> : null}
        {hub.news ? <LongReads g={g} /> : null}
        {hub.todos ? <Todos g={g} onNeedsLocation={() => setPlacesSheet(true)} /> : null}
        <Watching g={g} />
        <Connectors g={g} />
        {hub.catalog ? <MoreGooseCanDo g={g} /> : null}
        <Following g={g} />
      </ScrollView>
      <LocationSheet open={placesSheet} access={g.todos.access} onClose={() => setPlacesSheet(false)} onAllow={g.todos.actions.allowLocation} />
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    page: { flex: 1 },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, gap: Spacing['3xl'] },
    section: { gap: Spacing.md },
    group: { gap: Spacing.xs },
    invite: { gap: Spacing.sm },
    inviteActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs },
    start: { alignSelf: 'flex-start', marginTop: Spacing.xs },
    askCard: { paddingVertical: Spacing.xs, gap: 0 },
    divided: { borderTopWidth: StyleSheet.hairlineWidth },
    emptyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
    followHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
    pill: { paddingHorizontal: Spacing.lg, paddingVertical: 7, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  });
