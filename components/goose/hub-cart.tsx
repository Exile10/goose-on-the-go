/**
 * The cart: links Goose watches for price, each with its price set large, how it moved and its
 * history as a line, a field to watch another, and below them the listings the member kept,
 * grouped as filed, cheapest first.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkEmptyState, InkInput, InkSpinner, InkText, InkTitle, useInkTheme } from '@/components/ui/ink';

import { cartRange } from '@/components/patterns/goose-shelves';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { GPressable } from '@/components/ui/g-pressable';
import { Spacing } from '@/constants/spacing';
import { cartCurrency, linkFromPaste, targetFrom, type CartItem } from '@/models/cart';
import { isUnavailable } from '@/models/content-state';
import { formatMoney } from '@/models/me-read';
import { selectionTick } from '@/services/haptics';
import { useCart } from '@/view-models/use-cart';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { PriceMove, Sparkline } from './cart-parts';
import { HubPicture } from './hub-picture';
import { ScreenScroll, SectionHead, useAgo } from './hub-parts';
import { KeptLine } from './older-cart';
import { Labelled } from './labelled';

export function openCartItem(item: Pick<CartItem, 'id'>) {
  void selectionTick();
  router.push({ pathname: '/(stack)/goose-cart-item', params: { id: item.id } });
}

function WatchedRow({ item }: { item: CartItem }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const ago = useAgo();
  return (
    <GPressable feedback="lift" onPress={() => openCartItem(item)} accessibilityRole="button" accessibilityLabel={item.price ? `${item.title}, ${formatMoney(item.price)}` : item.title}>
      <InkCard raised={false}>
        <View style={styles.watched}>
          <HubPicture path={item.picture} label={item.title} style={[styles.thumb, { borderRadius: theme.radius.md }]} icon="cart" />
          <View style={styles.watchedWords}>
            <InkText size="sm" weight="semibold" tone="secondary" numberOfLines={1}>
              {item.site}
            </InkText>
            <InkText weight="semibold" numberOfLines={2}>
              {item.title}
            </InkText>
            <View style={styles.priceRow}>
              <InkText size="xl" weight="bold" numeric tone={item.price ? 'default' : 'tertiary'}>
                {item.price ? formatMoney(item.price) : t('goose.cart.noPrice')}
              </InkText>
              <Sparkline item={item} width={72} height={26} />
            </View>
            <PriceMove item={item} />
            <InkText size="xs" tone="tertiary">
              {item.status === 'checking' ? t('goose.cart.checking') : item.checkedAt ? t('goose.cart.checked', { when: ago(item.checkedAt) }) : t('goose.cart.notChecked')}
            </InkText>
          </View>
        </View>
      </InkCard>
    </GPressable>
  );
}

function WatchLink({ onWatch }: { onWatch: (pasted: string, target: string) => Promise<unknown> }) {
  const { t } = useTranslation();
  const [link, setLink] = useState('');
  const [target, setTarget] = useState('');
  const [sending, setSending] = useState(false);
  const bad = link.trim().length > 0 && !linkFromPaste(link);
  return (
    <View style={styles.form}>
      <Labelled label={t('goose.cart.linkLabel')}>
        <InkInput
          label={t('goose.cart.linkLabel')}
          value={link}
          onChange={setLink}
          placeholder={t('goose.cart.linkPlaceholder')}
          type="url"
          invalid={bad ? t('goose.cart.notALink') : undefined}
          inputProps={{ autoCapitalize: 'none', autoCorrect: false }}
        />
      </Labelled>
      <Labelled label={t('goose.cart.targetLabel')}>
        <InkInput label={t('goose.cart.targetLabel')} value={target} onChange={setTarget} placeholder={t('goose.cart.targetPlaceholder')} type="number" />
      </Labelled>
      <InkButton
        variant="primary"
        icon="eye"
        loading={sending}
        disabled={!linkFromPaste(link)}
        onPress={async () => {
          setSending(true);
          const made = await onWatch(link, target);
          setSending(false);
          if (made) {
            setLink('');
            setTarget('');
          }
        }}
      >
        {t('goose.cart.watch')}
      </InkButton>
    </View>
  );
}

export function HubCart() {
  const { t } = useTranslation();
  const cart = useCart();
  const pull = usePullToRefresh(cart.actions.reload);
  const items = cart.data;
  const state = useContentState({ loading: cart.loading, failed: cart.failed, hasContent: items.length + cart.kept.length > 0 });
  // A typed target is in the currency the member's other links are priced in, else shillings.
  const currency = cartCurrency(items);

  return (
    <ScreenScroll pull={pull}>
      <SectionHead title={t('goose.cart.screenTitle')} subtitle={t('goose.cart.subtitle')} />
      <InkCard>
        <InkText size="lg" weight="bold">
          {t('goose.cart.watchTitle')}
        </InkText>
        <WatchLink onWatch={(pasted, target) => cart.actions.watch(pasted, targetFrom(target, currency))} />
      </InkCard>

      {state === 'loading' ? <InkSpinner label={t('goose.cart.loading')} /> : null}
      {isUnavailable(state) ? <ContentUnavailable state={state} reason={cart.error} onRetry={cart.actions.reload} /> : null}
      {state === 'empty' ? (
        <InkEmptyState icon="cart" title={t('goose.cart.emptyTitle')}>
          <InkText tone="secondary">{t('goose.cart.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}

      {items.length ? (
        <View style={styles.section}>
          <SectionHead title={t('goose.cart.watchedTitle')} fact={t('goose.cart.onWatch', { count: items.length })} size="small" />
          {items.map((item) => (
            <WatchedRow key={item.id} item={item} />
          ))}
        </View>
      ) : null}

      {cart.kept.map((kept) => {
        const range = cartRange(kept, t);
        return (
          <View key={kept.name ?? ''} style={styles.section}>
            <View>
              <InkText size="sm" weight="semibold" tone="secondary">
                {t('goose.cart.keptListings', { count: kept.lines.length })}
              </InkText>
              <InkTitle level={3}>{kept.name ?? t('myGoose.cart.loose')}</InkTitle>
              {range ? (
                <InkText size="lg" weight="semibold" numeric>
                  {range}
                </InkText>
              ) : null}
            </View>
            {kept.lines.map((line) => (
              <KeptLine key={line.item.id} line={line} low={kept.low} />
            ))}
          </View>
        );
      })}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.md },
  form: { gap: Spacing.md, marginTop: Spacing.sm },
  watched: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  thumb: { width: 84, height: 84 },
  watchedWords: { flex: 1, gap: 3 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginTop: 2 },
});
