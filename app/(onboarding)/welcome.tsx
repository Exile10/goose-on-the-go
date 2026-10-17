/**
 * First run: Find your Pond. A new Pond is heard over Bluetooth or seen on this network, and is
 * claimed right here, under its own row, with its card's code; a scanned card picks its Pond and
 * claims it with nothing more to tap. A Pond that is already set up is joined through the pairing
 * wizard, below, as before.
 */

import React, { useCallback } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InkButton, InkCard, InkDots, InkNotice, InkSpinner, InkText, InkTitle } from '@jarida/ink/native';

import { PondList } from '@/components/patterns/pond-list';
import { NearbyPonds } from '@/components/setup/nearby-ponds';
import { PhoneName } from '@/components/setup/phone-name';
import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useTheme } from '@/providers/theme-provider';
import { selectionTick } from '@/services/haptics';
import { offerPairingPayload, offerPairingStart, takePairingPayload, type PairingStart } from '@/services/pairing-handoff';
import type { DiscoveredPond } from '@/services/discovery';
import { useFindPond } from '@/view-models/use-find-pond';
import { useNearbyPonds, type BleScan } from '@/view-models/use-nearby-ponds';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

function BluetoothLine({ ble, onFix }: { ble: BleScan; onFix: () => void }) {
  const { t } = useTranslation();
  switch (ble) {
    case 'off':
    case 'denied':
    case 'failed':
      return (
        <View style={lineStyles.notice}>
          <InkNotice tone="warning">
            {ble === 'off' ? t('bleSetup.find.bleOff') : ble === 'denied' ? t('bleSetup.find.bleDenied') : t('bleSetup.find.bleFailed')}
          </InkNotice>
          <View style={lineStyles.fix}>
            <InkButton variant="quiet" icon={ble === 'denied' ? 'settings' : 'refresh'} onPress={onFix}>
              {ble === 'denied' ? t('bleSetup.find.openSettings') : t('bleSetup.find.lookAgain')}
            </InkButton>
          </View>
        </View>
      );
    case 'unsupported':
      return (
        <InkText size="sm" tone="tertiary">
          {t('bleSetup.find.bleUnsupported')}
        </InkText>
      );
    default:
      return null;
  }
}

const lineStyles = StyleSheet.create({
  notice: { gap: Spacing.xs },
  fix: { alignItems: 'flex-start' },
});

export default function Welcome() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const router = useRouter();
  const nearby = useNearbyPonds();
  const find = useFindPond(nearby.data.fresh);
  const { fresh, joinable, ble, network } = nearby.data;
  const { phase, phoneName } = find.data;

  const scanCard = useCallback(() => {
    void selectionTick();
    router.push('/(stack)/connect-desktop');
  }, [router]);

  const openPairing = useCallback(
    (start: PairingStart) => {
      void selectionTick();
      find.actions.cancel();
      offerPairingStart(start);
      router.push('/(stack)/pond-pairing');
    },
    [router, find.actions],
  );

  // The scanner also reads a set-up Pond's pairing QR; that belongs to the wizard, which takes it on open.
  useFocusEffect(
    useCallback(() => {
      const payload = takePairingPayload();
      if (!payload) return;
      offerPairingPayload(payload);
      router.push('/(stack)/pond-pairing');
    }, [router]),
  );

  const onJoin = useCallback(
    (pond: DiscoveredPond) => openPairing({ kind: 'pond', url: pond.url, pin: pond.pin, unclaimed: pond.unclaimed }),
    [openPairing],
  );

  const searching = ble === 'starting' || ble === 'scanning' || network === 'searching';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <GKeyboardView>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Image
            source={isDark ? require('@/assets/images/logo-dark.png') : require('@/assets/images/logo.png')}
            style={styles.mark}
            resizeMode="contain"
          />
          <InkTitle level={1}>{t('bleSetup.find.title')}</InkTitle>
          <View style={styles.lede}>
            <InkText>{t('bleSetup.find.lede')}</InkText>
          </View>

          <View style={styles.path}>
            <InkButton variant="primary" block icon="camera" disabled={phase.kind === 'claiming'} onPress={scanCard}>
              {t('bleSetup.find.scanCard')}
            </InkButton>

            {phase.kind === 'looking' ? (
              <InkCard raised={false} contentStyle={styles.looking}>
                <View accessibilityLiveRegion="polite">
                  <InkSpinner label={t('bleSetup.find.looking', { id: phase.cardId })} />
                </View>
                {phase.late ? <InkText tone="secondary">{t('bleSetup.find.lookingLate', { id: phase.cardId })}</InkText> : null}
                <View style={styles.start}>
                  <InkButton variant="quiet" onPress={find.actions.cancel}>
                    {t('bleSetup.find.cancel')}
                  </InkButton>
                </View>
              </InkCard>
            ) : null}

            <BluetoothLine ble={ble} onFix={nearby.actions.fixBluetooth} />
            <NearbyPonds ponds={fresh} find={find} onScanCard={scanCard} />
            {fresh.length === 0 && phase.kind !== 'looking' ? (
              searching ? (
                <View style={styles.searching}>
                  <InkDots label={t('bleSetup.find.scanning')} />
                  <InkText size="sm" tone="tertiary">{t('bleSetup.find.scanning')}</InkText>
                </View>
              ) : (
                <InkText size="sm" tone="tertiary">{t('bleSetup.find.none')}</InkText>
              )
            ) : null}
            <PhoneName value={phoneName} onChange={find.actions.setPhoneName} disabled={phase.kind === 'claiming'} />
          </View>

          <View style={styles.path}>
            <InkTitle level={3}>{t('onboarding.joinTitle')}</InkTitle>
            <InkText tone="secondary">{t('onboarding.joinBody')}</InkText>
            {joinable.length > 0 ? (
              <PondList title={t('onboarding.joinFound')} ponds={joinable} phase={network} error={nearby.error} onSelect={onJoin} />
            ) : null}
            <InkButton variant="quiet" block icon="plus" onPress={() => openPairing({ kind: 'address' })}>
              {t('onboarding.manual')}
            </InkButton>
          </View>
        </ScrollView>
      </GKeyboardView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    scroll: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl },
    mark: { width: 56, height: 56, marginTop: Spacing.sm, marginBottom: Spacing.md },
    lede: { marginTop: Spacing.xs, maxWidth: 420 },
    path: { marginTop: Spacing.xl, gap: Spacing.md },
    looking: { gap: Spacing.sm },
    start: { alignItems: 'flex-start' },
    searching: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  });
