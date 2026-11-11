/**
 * My Goose — the middle tab: what the Goose is holding for this member. A Pond that serves the hub
 * (`GET /me/hub`) gets the hub; a Pond without it answers 404 and keeps the older My Goose, which
 * reads the routes that Pond already had.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InkSpinner, InkTitle } from '@/components/ui/ink';

import { HubMyGoose } from '@/components/goose/hub-my-goose';
import { OlderMyGoose } from '@/components/goose/older-my-goose';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useHub } from '@/view-models/use-hub';

export default function MyGooseTab() {
  const { state, hub } = useHub();
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  if (state === 'served' && hub) return <HubMyGoose hub={hub} />;
  if (state === 'probing') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <InkTitle level={1}>{t('myGoose.title')}</InkTitle>
        <InkSpinner label={t('myGoose.loading')} />
      </SafeAreaView>
    );
  }
  return <OlderMyGoose />;
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.xl },
  });
