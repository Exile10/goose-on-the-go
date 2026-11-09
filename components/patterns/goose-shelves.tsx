/**
 * My Goose's parts: the sentence it opens with, and a shelf per kind of thing the Goose holds.
 * Each shelf takes the shape of what it carries: a decision is a card with its two answers, a
 * watch is how many listings match, a brief is its own first lines, a cart is its price range.
 */

import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { InkBadge, InkButton, InkCard, InkLink, InkText, InkTitle, inkText, useInkTheme } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { IconName } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { formatPrice, type Brief, type Cart, type GooseClause } from '@/models/my-goose';
import { formatScheduleTime, runPreview } from '@/models/schedule';
import type { WebWatch } from '@/models/web-watches';
import type { ProposalRow } from '@/view-models/use-proposals';

/**
 * The sentence My Goose opens with. Every clause is a door to its shelf's own screen; the first is
 * the most urgent and is set in full ink, so the order reads without a label.
 */
export function GooseSentence({
  clauses,
  quiet,
  onOpen,
}: {
  clauses: GooseClause[];
  quiet: string;
  onOpen: (clause: GooseClause) => void;
}) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const said = inkText(theme, {
    role: 'display',
    size: 'xl',
    weight: 600,
    tracking: 'tight',
    color: theme.color.text,
  });
  const style = [said.style, styles.sentence];
  if (clauses.length === 0) return <Text style={style}>{quiet}</Text>;
  return (
    <Text style={style} accessibilityRole="text">
      {clauses.map((clause, i) => (
        <React.Fragment key={clause.shelf}>
          {i > 0 ? ' ' : null}
          <Text
            onPress={() => onOpen(clause)}
            accessibilityRole="link"
            suppressHighlighting={false}
            style={{ color: i === 0 ? theme.color.text : theme.color.textSecondary }}
          >
            {t(clause.key as never, clause.params) as string}
          </Text>
        </React.Fragment>
      ))}
    </Text>
  );
}

export function ShelfHeader({ title, count, onSeeAll }: { title: string; count?: number; onSeeAll?: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.shelfHeader}>
      <View style={styles.shelfTitle}>
        <InkTitle level={3}>{title}</InkTitle>
        {count && count > 1 ? <InkText tone="tertiary">{t('myGoose.shelf.count', { count })}</InkText> : null}
      </View>
      {onSeeAll ? (
        <InkLink standalone onPress={onSeeAll}>
          {t('myGoose.shelf.seeAll')}
        </InkLink>
      ) : null}
    </View>
  );
}

export function OfferCard({
  offer,
  more,
  deciding,
  onApprove,
  onDecline,
  onMore,
}: {
  offer: ProposalRow;
  more: number;
  deciding: boolean;
  onApprove: () => void;
  onDecline: () => void;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.gap}>
      <InkCard>
        <View style={styles.offer}>
          <InkText size="md" weight="semibold">
            {offer.summary}
          </InkText>
          <InkText size="sm" tone="secondary">
            {offer.rationale}
          </InkText>
          {offer.expires ? (
            <InkText size="xs" tone="tertiary">
              {t('myGoose.offer.until', { when: offer.expires })}
            </InkText>
          ) : null}
          <View style={styles.answers}>
            <InkButton variant="primary" size="sm" onPress={onApprove} loading={deciding}>
              {t('myGoose.offer.yes')}
            </InkButton>
            <InkButton size="sm" variant="quiet" onPress={onDecline} disabled={deciding}>
              {t('myGoose.offer.notNow')}
            </InkButton>
          </View>
        </View>
      </InkCard>
      {more > 0 ? (
        <InkLink standalone onPress={onMore}>
          {t('myGoose.offer.more', { count: more })}
        </InkLink>
      ) : null}
    </View>
  );
}

function watchStatus(watch: WebWatch, t: TFunction): string {
  if (watch.paused) return t('myGoose.watch.paused');
  if (watch.failures >= 3) return t('myGoose.watch.failing');
  if (!watch.lastCheckedAt) return t('myGoose.watch.notChecked');
  return t('myGoose.watch.checked', {
    when: formatScheduleTime(watch.lastCheckedAt),
  });
}

/** A watch as the number that matters about it: how many listings match what it looks for. */
export function WatchTile({ watch, onPress }: { watch: WebWatch; onPress: () => void }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const hit = watch.matchingCount > 0 && !watch.paused;
  const figure = inkText(theme, {
    role: 'display',
    size: 'xl',
    weight: 600,
    tracking: 'title',
    color: hit ? theme.color.text : theme.color.textTertiary,
  });
  return (
    <GPressable
      feedback="lift"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('myGoose.watch.open', {
        title: watch.title,
        count: watch.matchingCount,
      })}
      style={styles.tile}
    >
      <InkCard contentStyle={styles.tileBody}>
        <View style={styles.figureRow}>
          <Text style={[figure.style, styles.figure]}>{watch.matchingCount}</Text>
          <InkText size="sm" tone="secondary">
            {t('myGoose.watch.matches', { count: watch.matchingCount })}
          </InkText>
        </View>
        <InkText size="xs" tone="tertiary">
          {t('myGoose.watch.of', { total: watch.itemsCount })}
        </InkText>
        <View style={styles.tileTitle}>
          <InkText weight="semibold" numberOfLines={2}>
            {watch.title}
          </InkText>
        </View>
        <InkText size="xs" tone={watch.failures >= 3 ? 'default' : 'tertiary'} numberOfLines={1}>
          {watchStatus(watch, t)}
        </InkText>
      </InkCard>
    </GPressable>
  );
}

export function WatchShelf({ watches, onOpen }: { watches: WebWatch[]; onOpen: (watch: WebWatch) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tiles}
      style={styles.bleed}
    >
      {watches.map((w) => (
        <WatchTile key={w.id} watch={w} onPress={() => onOpen(w)} />
      ))}
    </ScrollView>
  );
}

/** The latest brief, opened on its first lines. */
export function BriefCard({ brief, onPress, lines = 4 }: { brief: Brief; onPress: () => void; lines?: number }) {
  const { t } = useTranslation();
  return (
    <GPressable feedback="lift" onPress={onPress} accessibilityRole="button" accessibilityLabel={brief.name}>
      <InkCard>
        <View style={styles.offer}>
          <View style={styles.briefHead}>
            <InkText weight="semibold" numberOfLines={1}>
              {brief.name}
            </InkText>
            <InkText size="xs" tone="tertiary">
              {t('myGoose.news.written', {
                when: formatScheduleTime(brief.at),
              })}
            </InkText>
          </View>
          <InkText size="sm" tone="secondary" numberOfLines={lines}>
            {runPreview(brief.text).text}
          </InkText>
        </View>
      </InkCard>
    </GPressable>
  );
}

/** Up to three of a cart's photos, overlapped, so a row shows what was kept and not only its name. */
export function PhotoStack({ photos, size = 44 }: { photos: string[]; size?: number }) {
  const theme = useInkTheme();
  const shown = photos.filter((p) => /^https?:\/\//i.test(p)).slice(0, 3);
  if (shown.length === 0) return null;
  return (
    <View style={[styles.stack, { width: size + (shown.length - 1) * (size * 0.55) }]}>
      {shown.map((uri, i) => (
        <Image
          key={uri}
          source={{ uri }}
          style={[
            styles.stackPhoto,
            {
              width: size,
              height: size,
              left: i * size * 0.55,
              borderRadius: theme.radius.md,
              borderColor: theme.color.surface,
              backgroundColor: theme.color.line,
            },
          ]}
        />
      ))}
    </View>
  );
}

export function cartRange(cart: Cart, t: TFunction): string | null {
  if (!cart.low) return null;
  return cart.high
    ? t('myGoose.cart.range', {
        low: formatPrice(cart.low),
        high: formatPrice(cart.high),
      })
    : formatPrice(cart.low);
}

export function CartRow({ cart, onPress }: { cart: Cart; onPress: () => void }) {
  const { t } = useTranslation();
  const range = cartRange(cart, t);
  const name = cart.name ?? t('myGoose.cart.loose');
  return (
    <GPressable
      feedback="lift"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={range ? `${name}, ${range}` : name}
    >
      <InkCard>
        <View style={styles.cartRow}>
          <View style={styles.cartWords}>
            <InkText size="xs" tone="tertiary">
              {t('myGoose.cart.listings', { count: cart.lines.length })}
            </InkText>
            <InkText weight="semibold" numberOfLines={2}>
              {name}
            </InkText>
            {range ? (
              <InkText size="md" weight="semibold" numeric>
                {range}
              </InkText>
            ) : null}
          </View>
          <PhotoStack photos={cart.lines.flatMap((l) => l.item.photos.slice(0, 1))} />
        </View>
      </InkCard>
    </GPressable>
  );
}

/** A row with its glyph on a soft tile, the way the You tab draws a destination. */
export function GlyphRow({
  icon,
  title,
  detail,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName;
  title: string;
  detail?: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useInkTheme();
  return (
    <GPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={styles.glyphRow}
    >
      <View
        style={[
          styles.glyphTile,
          {
            backgroundColor: theme.color.accentSoft,
            borderRadius: theme.radius.md,
          },
        ]}
      >
        <GIcon name={icon} size={18} color={theme.color.accentLine} />
      </View>
      <View style={styles.glyphWords}>
        <InkText numberOfLines={3}>{title}</InkText>
        {detail ? (
          <InkText size="xs" tone="tertiary" numberOfLines={2}>
            {detail}
          </InkText>
        ) : null}
      </View>
      <GIcon name="chevron-right" size={16} color={theme.color.textTertiary} />
    </GPressable>
  );
}

export function LowestBadge() {
  const { t } = useTranslation();
  return <InkBadge tone="success">{t('myGoose.cart.lowest')}</InkBadge>;
}

const styles = StyleSheet.create({
  sentence: { fontSize: 25, lineHeight: 34 },
  shelfHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  shelfTitle: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.sm,
    flexShrink: 1,
  },
  gap: { gap: Spacing.sm },
  offer: { gap: Spacing.xs },
  answers: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  bleed: { marginHorizontal: -Spacing.lg },
  tiles: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  tile: { width: 168 },
  tileBody: { gap: 2 },
  figureRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.xs },
  figure: { fontSize: 34, lineHeight: 38 },
  tileTitle: { marginTop: Spacing.sm, marginBottom: Spacing.xs, minHeight: 40 },
  briefHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: Spacing.sm,
  },
  stack: { height: 44, position: 'relative' },
  stackPhoto: { position: 'absolute', top: 0, borderWidth: 2 },
  cartRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  cartWords: { flex: 1, gap: 2 },
  glyphRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  glyphTile: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphWords: { flex: 1, gap: 2 },
});
