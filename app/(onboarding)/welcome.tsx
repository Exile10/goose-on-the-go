/**
 * First run.
 *
 * The hero is the network scan itself, not a carousel: what distinguishes this
 * app from a hosted assistant is that the thing it talks to is yours and is on
 * this network, and watching it appear says that better than a slide claiming
 * it. Pairing proper lives in the pond-pairing screen, which this hands off to:
 * a Pond picked here opens the wizard at that Pond, and "Enter an address" opens
 * it at the address form, so neither shows the search a second time.
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
import { selectionTick } from '@/services/haptics';
import { offerPairingStart, type PairingStart } from '@/services/pairing-handoff';
import type { DiscoveredPond } from '@/services/discovery';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

export default function Welcome() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const router = useRouter();
  const discovery = useDiscovery();

  const openPairing = useCallback(
    (start: PairingStart) => {
      void selectionTick();
      offerPairingStart(start);
      router.push('/(stack)/pond-pairing');
    },
    [router],
  );

  const onSelect = useCallback(
    (pond: DiscoveredPond) => openPairing({ kind: 'pond', url: pond.url, pin: pond.pin, unclaimed: pond.unclaimed }),
    [openPairing],
  );
  const { ponds, phase } = discovery.data;
  const fresh = ponds.filter((p) => p.unclaimed);
  const claimed = ponds.filter((p) => !p.unclaimed);

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

        {/* Two ways in, because a Pond nobody has set up is claimed with its card and then set up from
            here, while one already set up only needs this phone paired to it. */}
        <View style={styles.path}>
          <InkTitle level={3}>{t('onboarding.newTitle')}</InkTitle>
          <InkText tone="secondary">{t('onboarding.newBody')}</InkText>
          <InkButton variant="primary" block icon="camera" onPress={() => openPairing({ kind: 'scan' })}>
            {t('onboarding.scanCard')}
          </InkButton>
          {fresh.length > 0 ? (
            <PondList title={t('onboarding.newFound')} ponds={fresh} phase={phase} onSelect={onSelect} />
          ) : phase !== 'searching' ? (
            <InkText size="sm" tone="tertiary">{t('onboarding.newNone')}</InkText>
          ) : null}
        </View>

        <View style={styles.path}>
          <InkTitle level={3}>{t('onboarding.joinTitle')}</InkTitle>
          <InkText tone="secondary">{t('onboarding.joinBody')}</InkText>
          {claimed.length > 0 || ponds.length === 0 ? (
            <PondList
              title={t('onboarding.joinFound')}
              ponds={claimed}
              phase={phase}
              error={discovery.error}
              onSelect={onSelect}
            />
          ) : null}
          <InkButton variant="quiet" block icon="plus" onPress={() => openPairing({ kind: 'address' })}>
            {t('onboarding.manual')}
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
    path: { marginTop: Spacing.lg, gap: Spacing.sm },
  });
