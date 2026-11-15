/**
 * For a Pond without `/me/hub`, unchanged from before the hub.
 *
 * Cart — the listings the Goose kept for this member, a cart per collection. Kept listings are
 * alternatives to choose between, so each cart says its price range and marks the lowest price
 * rather than adding them up.
 */

import React from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkEmptyState, InkNotice, InkSpinner, InkText, InkTitle, useInkTheme } from '@/components/ui/ink';

import { LowestBadge, cartRange } from '@/components/patterns/goose-shelves';
import { GPressable } from '@/components/ui/g-pressable';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { cartsFrom, formatPrice, type CartLine, type Price } from '@/models/my-goose';
import { selectionTick } from '@/services/haptics';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { useSavedItems } from '@/view-models/use-saved-items';

/** What a listing is besides its price, in the order a buyer reads it. */
function details(line: CartLine): string {
  const { item } = line;
  return [item.year, item.mileage, item.location].filter(Boolean).join(', ');
}

export function KeptLine({ line, low }: { line: CartLine; low: Price | null }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const photo = line.item.photos.find((p) => /^https?:\/\//i.test(p));
  const price = line.price ? formatPrice(line.price) : (line.item.price ?? null);
  // What choosing this one over the cheapest costs, which is the comparison a kept listing is for.
  const more =
    low && line.price && line.price.currency === low.currency && line.price.amount > low.amount
      ? formatPrice({ amount: line.price.amount - low.amount, currency: low.currency })
      : null;
  const open = () => {
    void selectionTick();
    router.push({ pathname: '/(stack)/saved-item', params: { id: line.item.id } } as never);
  };
  return (
    <GPressable
      feedback="lift"
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={price ? `${line.item.title}, ${price}` : line.item.title}
    >
      <InkCard>
        <View style={styles.line}>
          {photo ? <Image source={{ uri: photo }} style={[styles.photo, { borderRadius: theme.radius.md }]} /> : null}
          <View style={styles.words}>
            <InkText weight="semibold" numberOfLines={2}>{line.item.title}</InkText>
            {details(line) ? <InkText size="xs" tone="tertiary" numberOfLines={1}>{details(line)}</InkText> : null}
            <View style={styles.priceRow}>
              <InkText size="md" weight="semibold" numeric tone={price ? 'default' : 'tertiary'}>
                {price ?? t('myGoose.cart.noPrice')}
              </InkText>
              {line.cheapest ? <LowestBadge /> : null}
            </View>
            {more ? <InkText size="xs" tone="tertiary">{t('myGoose.cart.more', { amount: more })}</InkText> : null}
          </View>
        </View>
      </InkCard>
    </GPressable>
  );
}

export function OlderCart() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const { data, loading, error, actions } = useSavedItems();
  const pull = usePullToRefresh(actions.refresh);
  const carts = cartsFrom(data.items);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl {...pull} />}
    >
      {carts.length > 0 ? <InkText size="sm" tone="secondary">{t('myGoose.cart.intro')}</InkText> : null}
      {loading && data.items.length === 0 ? <InkSpinner label={t('myGoose.loading')} /> : null}
      {error ? <InkNotice tone="danger">{error}</InkNotice> : null}
      {!loading && !error && carts.length === 0 ? (
        <InkEmptyState
          icon="package"
          title={t('myGoose.cart.emptyTitle')}
          action={
            <InkButton variant="primary" onPress={() => router.push('/conversation' as never)}>{t('myGoose.try.startChat')}</InkButton>
          }
        >
          <InkText tone="secondary">{t('myGoose.cart.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}
      {carts.map((cart) => {
        const range = cartRange(cart, t);
        return (
          <View key={cart.name ?? ''} style={styles.cart}>
            <View style={styles.cartHead}>
              <InkText size="xs" tone="tertiary">{t('myGoose.cart.listings', { count: cart.lines.length })}</InkText>
              <InkTitle level={3}>{cart.name ?? t('myGoose.cart.loose')}</InkTitle>
              {range ? <InkText size="lg" weight="semibold" numeric>{range}</InkText> : null}
            </View>
            {cart.lines.map((line) => (
              <KeptLine key={line.item.id} line={line} low={cart.low} />
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.lg, gap: Spacing.xl, paddingBottom: Spacing['4xl'] },
    cart: { gap: Spacing.md },
    cartHead: { gap: 2 },
    line: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
    photo: { width: 64, height: 64 },
    words: { flex: 1, gap: 2 },
    priceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs },
  });
