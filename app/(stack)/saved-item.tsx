/**
 * SavedItemScreen — one kept card whole: a recipe's ingredients and steps, a listing's facts and
 * page, its text and sources. The owner can share it with the household, watch a listing's price,
 * or delete it; a card shared by someone else is read only.
 */

import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkEyebrow, InkNotice, InkSpinner, InkSwitch, InkText } from '@jarida/ink/native';

import { Markdown } from '@/components/patterns/markdown';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { siteOf } from '@/models/web-watches';
import { useConfirm } from '@/providers/confirm-provider';
import { confirm as confirmTick, toggle } from '@/services/haptics';
import { savedKindKey, savedSummary } from '@/view-models/saved-words';
import { useSavedItem } from '@/view-models/use-saved-items';

function idOf(param: string | string[] | undefined): string {
  const id = Array.isArray(param) ? param[0] : param;
  return id && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : '';
}

export default function SavedItemScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const ask = useConfirm();
  const id = idOf(useLocalSearchParams<{ id?: string }>().id);
  const { item, loading, error, busy, gone, watching, actions } = useSavedItem(id);

  const remove = useCallback(async () => {
    const yes = await ask({
      title: t('saved.deleteTitle'),
      message: t('saved.deleteBody'),
      confirmLabel: t('saved.delete'),
      destructive: true,
    });
    if (yes && (await actions.remove())) {
      void confirmTick();
      router.back();
    }
  }, [actions, ask, t]);

  if (gone || !id) {
    return (
      <View style={styles.container}>
        <View style={styles.scroll}>
          <InkNotice tone="neutral">{t('saved.gone')}</InkNotice>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      {loading && !item ? <InkSpinner label={t('saved.loading')} /> : null}
      {error ? <InkNotice tone="danger">{error}</InkNotice> : null}
      {item ? (
        <>
          <InkEyebrow>{[t(savedKindKey(item.kind)), item.collection].filter(Boolean).join(' · ')}</InkEyebrow>
          <InkText size="lg" weight="semibold">{item.title}</InkText>
          {savedSummary(item) && item.kind !== 'note' && item.kind !== 'report' ? (
            <InkText tone="secondary">{savedSummary(item)}</InkText>
          ) : null}

          {item.ingredients.length > 0 ? (
            <InkCard>
              <InkEyebrow>{t('saved.ingredients')}</InkEyebrow>
              {item.ingredients.map((line, i) => (
                <InkText key={i}>{`• ${line}`}</InkText>
              ))}
            </InkCard>
          ) : null}
          {item.steps.length > 0 ? (
            <InkCard>
              <InkEyebrow>{t('saved.steps')}</InkEyebrow>
              {item.steps.map((line, i) => (
                <InkText key={i}>{`${i + 1}. ${line}`}</InkText>
              ))}
            </InkCard>
          ) : null}
          {item.ingredients.length === 0 && item.steps.length === 0 && item.body.trim() !== '' ? (
            <Markdown source={item.body} />
          ) : null}

          {item.link ? (
            <InkButton variant="quiet" icon="external" onPress={() => void WebBrowser.openBrowserAsync(item.link!)}>
              {t('saved.openPage', { site: siteOf(item.link) })}
            </InkButton>
          ) : null}
          {item.sources.length > 0 ? (
            <View style={styles.sources}>
              <InkEyebrow>{t('saved.sources', { count: item.sources.length })}</InkEyebrow>
              {item.sources.map((s) => (
                <InkButton key={s.url} variant="quiet" icon="link" onPress={() => void WebBrowser.openBrowserAsync(s.url)}>
                  {s.title}
                </InkButton>
              ))}
            </View>
          ) : null}

          {item.mine ? (
            <InkCard>
              <InkSwitch
                checked={item.shared}
                disabled={busy}
                label={t('saved.shareWithHousehold')}
                onChange={(on) => {
                  void toggle();
                  void actions.share(on);
                }}
              />
              {item.link && (item.kind === 'listing' || item.kind === 'place') ? (
                <InkButton
                  icon="eye"
                  disabled={busy || watching}
                  onPress={() => void actions.watchPrice().then((w) => w && confirmTick())}
                >
                  {watching ? t('saved.watching') : t('saved.watchPrice')}
                </InkButton>
              ) : null}
              <InkButton variant="quiet" icon="trash" disabled={busy} onPress={() => void remove()}>
                {t('saved.delete')}
              </InkButton>
            </InkCard>
          ) : (
            <InkText size="sm" tone="tertiary">{t('saved.sharedByOther')}</InkText>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing['4xl'] },
    sources: { gap: Spacing.xs },
  });
