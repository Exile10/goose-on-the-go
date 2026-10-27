/**
 * Choosing between Ponds.
 *
 * A household can run more than one — a desktop and a box in a cupboard — and
 * the app has always been able to reach only whichever it last paired with.
 * The list is the same component first run uses, so the two cannot drift.
 *
 * None of it needs the current Pond to answer: this is where an offline home card sends someone.
 * A Pond that is new or was reset has not joined this network, so it is not on the list; it is set
 * up over Bluetooth or from its card, which is first run's screen, and that screen works over a
 * pairing that is still stored. Until 2026-10-27 nothing here led to it, and first run itself only
 * opens when nothing is paired, so a phone whose Pond had gone could not set up its replacement.
 */

import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InkButton, InkNotice, InkText } from '@jarida/ink/native';

import { PondList } from '@/components/patterns/pond-list';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useDiscovery } from '@/view-models/use-discovery';
import { useServer } from '@/providers/server-provider';
import { selectionTick } from '@/services/haptics';
import { offerPairingStart, type PairingStart } from '@/services/pairing-handoff';
import type { DiscoveredPond } from '@/services/discovery';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

export default function SwitchPond() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const discovery = useDiscovery();
  const { serverUrl } = useServer();

  const openPairing = useCallback(
    (start: PairingStart) => {
      offerPairingStart(start);
      router.push('/(stack)/pond-pairing');
    },
    [router],
  );

  const onSelect = useCallback(
    (pond: DiscoveredPond) => {
      void selectionTick();
      if (pond.url === serverUrl) return;
      openPairing({ kind: 'pond', url: pond.url, pin: pond.pin, unclaimed: pond.unclaimed });
    },
    [openPairing, serverUrl],
  );

  const { ponds, phase } = discovery.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ title: t('pond.switch'), headerShown: true }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <InkText>{t('pond.switchBody')}</InkText>
        </View>

        <PondList
          title={t('pond.onThisNetwork')}
          ponds={ponds}
          phase={phase}
          error={discovery.error}
          currentUrl={serverUrl}
          onSelect={onSelect}
        />

        {phase === 'failed' ? (
          <View style={styles.notice}>
            <InkNotice tone="warning">{t('pond.discoveryFailed')}</InkNotice>
          </View>
        ) : null}

        <View style={styles.actions}>
          <InkButton
            variant="quiet"
            block
            icon="refresh"
            onPress={() => {
              void selectionTick();
              discovery.actions.retry();
            }}
          >
            {t('common.refresh')}
          </InkButton>
          <InkButton
            variant="primary"
            block
            icon="plus"
            onPress={() => openPairing({ kind: 'address' })}
          >
            {t('onboarding.manual')}
          </InkButton>
        </View>

        <View style={styles.setUp}>
          <InkText tone="secondary">{t('pond.setUpNewBody')}</InkText>
          <InkButton
            variant="quiet"
            block
            icon="server"
            onPress={() => {
              void selectionTick();
              router.push('/(onboarding)/welcome');
            }}
          >
            {t('pond.setUpNew')}
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
    intro: { marginTop: Spacing.md, marginBottom: Spacing.lg, maxWidth: 420 },
    notice: { marginTop: Spacing.md },
    actions: { marginTop: Spacing.lg, gap: Spacing.sm },
    setUp: { marginTop: Spacing.xl, gap: Spacing.sm },
  });
