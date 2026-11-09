/**
 * Choosing between Ponds.
 *
 * A household can run more than one — a desktop and a box in a cupboard — and
 * the app has always been able to reach only whichever it last paired with.
 * The list is the same component first run uses, so the two cannot drift.
 *
 * None of it needs the current Pond to answer: this is where an offline home card sends someone.
 * So it opens on that Pond, recognised on the network by its pin (`sectionPonds`), with the
 * connection's state and Try now on its card; the strip under other stack screens' title bars stays
 * off this one. Below are the other Ponds heard on this network. A Pond that is new or was reset has
 * not joined this network, so it is not on the list; it is set up over Bluetooth or from its card,
 * which is first run's screen, and that screen works over a pairing that is still stored. Until
 * 2026-10-27 nothing here led to it, and first run itself only opens when nothing is paired, so a
 * phone whose Pond had gone could not set up its replacement.
 */

import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkEyebrow, InkNotice, InkText } from '@/components/ui/ink';

import { PondList } from '@/components/patterns/pond-list';
import { PondStatusCard } from '@/components/patterns/pond-status-card';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { sectionPonds } from '@/models/switch-pond';
import { logFailure } from '@/view-models/describe-error';
import { useDiscovery } from '@/view-models/use-discovery';
import { useServer } from '@/providers/server-provider';
import { useSnackbar } from '@/providers/snackbar-provider';
import { selectionTick } from '@/services/haptics';
import { hostOf, type DiscoveredPond } from '@/services/discovery';
import { offerPairingStart, type PairingStart } from '@/services/pairing-handoff';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

export default function SwitchPond() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const snackbar = useSnackbar();
  const discovery = useDiscovery();
  const { pairedPin, pondUrls, tryAddress } = useServer();
  const [following, setFollowing] = useState(false);

  const openPairing = useCallback(
    (start: PairingStart) => {
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
  const { current, moved, others } = sectionPonds(ponds, { pin: pairedPin, urls: pondUrls });

  // The address is checked under the saved pin before anything is kept, so only the real Pond can answer there.
  const follow = useCallback(
    async (pond: DiscoveredPond) => {
      void selectionTick();
      setFollowing(true);
      try {
        const reached = await tryAddress(pond.url);
        console.info('[switch-pond] moved address tried', { kind: 'pond_moved_tried', answered: reached === pond.url });
        snackbar.show(
          reached === pond.url
            ? { message: t('pond.movedDone', { address: hostOf(pond.url) }) }
            : { message: t('pond.movedFailed'), tone: 'danger' },
        );
      } catch (e) {
        logFailure('switch-pond', 'moved address could not be tried', e);
        snackbar.show({ message: t('pond.movedFailed'), tone: 'danger' });
      } finally {
        setFollowing(false);
      }
    },
    [snackbar, t, tryAddress],
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: t('pond.switch'), headerShown: true }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {pondUrls.length > 0 ? <PondStatusCard name={current?.name} address={hostOf(pondUrls[0])} /> : null}

        {moved ? (
          <View style={styles.notice}>
            <InkNotice
              tone="info"
              action={
                <InkButton variant="primary" icon="server" loading={following} onPress={() => void follow(moved)}>
                  {t('pond.useAddress')}
                </InkButton>
              }
            >
              {t('pond.moved', { address: hostOf(moved.url) })}
            </InkNotice>
          </View>
        ) : null}

        {others.length === 0 && ponds.length > 0 ? (
          <View style={styles.none}>
            <InkEyebrow>{t('pond.othersOnNetwork')}</InkEyebrow>
            <InkText tone="secondary">{t('pond.noOthers')}</InkText>
          </View>
        ) : (
          <PondList
            title={t('pond.othersOnNetwork')}
            ponds={others}
            phase={phase}
            error={discovery.error}
            onSelect={onSelect}
          />
        )}

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
            {t('pond.searchAgain')}
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
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.xl },
    notice: { marginBottom: Spacing.lg },
    none: { gap: Spacing.sm },
    actions: { marginTop: Spacing.lg, gap: Spacing.sm },
    setUp: { marginTop: Spacing.xl, gap: Spacing.sm },
  });
