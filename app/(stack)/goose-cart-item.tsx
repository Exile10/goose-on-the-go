/**
 * One watched link: its picture, its price set large and how it moved, the price over time, when
 * Goose last looked, and what the member wants to hear about: any drop, their price, back in stock,
 * or any change. Check now reads the page at once.
 */

import React, { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkChip, InkInput, InkRadioGroup, InkSpinner, InkText, inkText, useInkTheme } from '@/components/ui/ink';

import { PriceMove, Sparkline } from '@/components/goose/cart-parts';
import { HubPicture } from '@/components/goose/hub-picture';
import { Labelled } from '@/components/goose/labelled';
import { ScreenScroll, SectionHead, useAgo } from '@/components/goose/hub-parts';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { DangerQuietButton } from '@/components/pond/danger-quiet-button';
import { Spacing } from '@/constants/spacing';
import { CHECK_EVERY, DEFAULT_CURRENCY, NOTIFY_CHOICES, targetFrom, type CartNotify } from '@/models/cart';
import { isUnavailable } from '@/models/content-state';
import { formatMoney } from '@/models/me-read';
import { useConfirm } from '@/providers/confirm-provider';
import { useCart } from '@/view-models/use-cart';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

export default function GooseCartItemScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const theme = useInkTheme();
  const { t } = useTranslation();
  const ago = useAgo();
  const ask = useConfirm();
  const cart = useCart();
  const pull = usePullToRefresh(cart.actions.reload);
  const item = cart.data.find((i) => i.id === id) ?? null;
  const state = useContentState({ loading: cart.loading, failed: cart.failed, hasContent: !!item });
  const [checking, setChecking] = useState(false);
  // What the member typed; until then, the target the link already has.
  const [typed, setTarget] = useState<string | null>(null);
  const target = typed ?? (item?.target ? String(item.target.amount) : '');
  const price = inkText(theme, { role: 'display', size: '3xl', weight: 700, tracking: 'title', color: theme.color.text }).style;

  const notifyLabel = (n: CartNotify) =>
    n === 'drop' ? t('goose.cart.notifyDrop') : n === 'target' ? t('goose.cart.notifyTarget') : n === 'stock' ? t('goose.cart.notifyStock') : t('goose.cart.notifyAny');

  return (
    <ScreenScroll pull={pull}>
      {state === 'loading' ? <InkSpinner label={t('goose.cart.loading')} /> : null}
      {isUnavailable(state) ? <ContentUnavailable state={state} reason={cart.error} onRetry={cart.actions.reload} /> : null}
      {!cart.loading && !item && state !== 'unreachable' && state !== 'failed' ? <InkText tone="secondary">{t('goose.cart.gone')}</InkText> : null}
      {item ? (
        <>
          <HubPicture path={item.picture} label={item.title} style={[styles.picture, { borderRadius: theme.radius.lg }]} icon="cart" iconSize={40} />
          <View style={styles.head}>
            <InkText size="sm" weight="semibold" tone="secondary">
              {item.site}
            </InkText>
            <InkText size="lg" weight="bold">
              {item.title}
            </InkText>
            <Text style={price}>{item.price ? formatMoney(item.price) : t('goose.cart.noPrice')}</Text>
            <PriceMove item={item} />
            {item.inStock === false ? (
              <InkText size="sm" weight="semibold" style={{ color: theme.color.warningFg }}>
                {t('goose.cart.outOfStock')}
              </InkText>
            ) : null}
          </View>

          {item.history.length > 1 ? (
            <InkCard>
              <InkText size="sm" weight="bold" tone="secondary">
                {t('goose.cart.history')}
              </InkText>
              <Sparkline item={item} width={300} height={90} />
              <View style={styles.range}>
                {item.lowest ? (
                  <InkText size="sm" tone="secondary">
                    {t('goose.cart.lowestWas', { price: formatMoney(item.lowest) })}
                  </InkText>
                ) : null}
                {item.highest ? (
                  <InkText size="sm" tone="secondary">
                    {t('goose.cart.highestWas', { price: formatMoney(item.highest) })}
                  </InkText>
                ) : null}
              </View>
            </InkCard>
          ) : null}

          <View style={styles.section}>
            <InkText size="sm" tone="secondary">
              {[
                item.checkedAt ? t('goose.cart.checked', { when: ago(item.checkedAt) }) : t('goose.cart.notChecked'),
                t('goose.cart.every', { count: item.everyHours }),
              ].join('. ')}
            </InkText>
            {item.status === 'failing' ? (
              <InkText size="sm" style={{ color: theme.color.warningFg }}>
                {t('goose.cart.failingBody')}
              </InkText>
            ) : null}
            <View style={styles.buttons}>
              <InkButton
                variant="primary"
                icon="refresh"
                loading={checking}
                onPress={async () => {
                  setChecking(true);
                  await cart.actions.check(item.id);
                  setChecking(false);
                }}
              >
                {t('goose.cart.checkNow')}
              </InkButton>
              <InkButton variant="quiet" icon="external" onPress={() => void Linking.openURL(item.url)}>
                {t('goose.cart.openPage')}
              </InkButton>
            </View>
          </View>

          <View style={styles.section}>
            <SectionHead title={t('goose.cart.tellMe')} size="small" />
            <InkRadioGroup
              label={t('goose.cart.tellMe')}
              value={item.notify}
              options={NOTIFY_CHOICES.map((n) => ({ value: n, label: notifyLabel(n) }))}
              onChange={(v) => void cart.actions.edit(item.id, { notify: v as CartNotify })}
            />
          </View>

          <View style={styles.section}>
            <Labelled label={t('goose.cart.targetLabel')}>
              <InkInput label={t('goose.cart.targetLabel')} value={target} onChange={setTarget} type="number" placeholder={t('goose.cart.targetPlaceholder')} />
            </Labelled>
            <InkButton
              variant="quiet"
              icon="target"
              onPress={() => void cart.actions.edit(item.id, { target: targetFrom(target, item.price?.currency ?? item.target?.currency ?? DEFAULT_CURRENCY) })}
              style={styles.left}
            >
              {target.trim() ? t('goose.cart.saveTarget') : t('goose.cart.clearTarget')}
            </InkButton>
          </View>

          <View style={styles.section}>
            <InkText size="sm" weight="bold" tone="secondary">
              {t('goose.cart.howOften')}
            </InkText>
            <View style={styles.chips}>
              {CHECK_EVERY.map((h) => (
                <InkChip key={h} selected={item.everyHours === h} onPress={() => void cart.actions.edit(item.id, { everyHours: h })}>
                  {t('goose.cart.everyChip', { count: h })}
                </InkChip>
              ))}
            </View>
          </View>

          <DangerQuietButton
            icon="trash"
            onPress={async () => {
              const yes = await ask({ title: t('goose.cart.stopTitle'), message: t('goose.cart.stopBody'), confirmLabel: t('goose.cart.stop'), destructive: true });
              if (yes && (await cart.actions.stop(item.id))) router.back();
            }}
          >
            {t('goose.cart.stop')}
          </DangerQuietButton>
        </>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  picture: { width: '100%', aspectRatio: 4 / 3 },
  head: { gap: 4 },
  range: { flexDirection: 'row', justifyContent: 'space-between' },
  section: { gap: Spacing.sm },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  left: { alignSelf: 'flex-start' },
});
