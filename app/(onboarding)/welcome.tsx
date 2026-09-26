/**
 * First run.
 *
 * The hero is the network scan itself, not a carousel: what distinguishes this
 * app from a hosted assistant is that the thing it talks to is yours and is on
 * this network, and watching it appear says that better than a slide claiming
 * it. Pairing proper lives in the pond-pairing screen, which this hands off to.
 */

import React, { useCallback } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InkButton, InkText, InkTitle } from '@jarida/ink/native';

import { PondList } from '@/components/patterns/pond-list';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useTheme } from '@/providers/theme-provider';
import { useDiscovery } from '@/view-models/use-discovery';
import { useOnboarding } from '@/view-models/use-onboarding';
import { selectionTick, tap } from '@/services/haptics';
import type { DiscoveredPond } from '@/services/discovery';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

export default function Welcome() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const router = useRouter();
  const discovery = useDiscovery();
  const { actions } = useOnboarding();

  const openPairing = useCallback(
    (url?: string) => {
      void selectionTick();
      router.push({ pathname: '/(stack)/pond-pairing', params: url ? { url } : {} });
    },
    [router],
  );

  const later = useCallback(() => {
    void tap();
    actions.dismiss();
    router.replace('/(tabs)');
  }, [actions, router]);

  const onSelect = useCallback((pond: DiscoveredPond) => openPairing(pond.url), [openPairing]);
  const { ponds, phase } = discovery.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Image
          source={
            isDark
              ? require('@/assets/images/logo-dark.png')
              : require('@/assets/images/logo.png')
          }
          style={styles.mark}
          resizeMode="contain"
        />
        <InkTitle level={1}>{t('onboarding.welcomeTitle')}</InkTitle>
        <View style={styles.lede}>
          <InkText>{t('onboarding.welcomeBody')}</InkText>
        </View>

        <PondList
          title={t('onboarding.findTitle')}
          ponds={ponds}
          phase={phase}
          error={discovery.error}
          onSelect={onSelect}
        />

        <View style={styles.actions}>
          <InkButton variant="primary" block icon="plus" onPress={() => openPairing()}>
            {t('onboarding.manual')}
          </InkButton>
          <InkButton variant="quiet" block onPress={later}>
            {t('onboarding.skip')}
          </InkButton>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    scroll: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl },
    mark: { width: 72, height: 72, marginTop: Spacing.xl, marginBottom: Spacing.md },
    lede: { marginBottom: Spacing.lg, maxWidth: 420 },
    actions: { marginTop: Spacing.lg, gap: Spacing.sm },
  });
