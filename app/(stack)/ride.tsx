import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InkButton, InkNotice, InkText, InkTitle } from '@jarida/ink/native';

import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useRide } from '@/view-models/use-ride';
import type { RideProblem } from '@/models/ride-flow';
import type { BookedRide, RideStatus } from '@/services/types';

/** One literal key per status, so services/__tests__/i18n.test.ts can see each one. */
function statusLabel(t: TFunction, status: RideStatus): string {
  if (typeof status !== 'string') return t('ride.status.other');
  switch (status) {
    case 'processing': return t('ride.status.processing');
    case 'accepted': return t('ride.status.accepted');
    case 'arriving': return t('ride.status.arriving');
    case 'in_progress': return t('ride.status.in_progress');
    case 'completed': return t('ride.status.completed');
    case 'no_drivers_available': return t('ride.status.no_drivers_available');
    case 'driver_canceled': return t('ride.status.driver_canceled');
    case 'rider_canceled': return t('ride.status.rider_canceled');
  }
}

function problemLabel(t: TFunction, problem: RideProblem): string {
  switch (problem) {
    case 'locationDenied': return t('ride.problem.locationDenied');
    case 'notLinked': return t('ride.problem.notLinked');
    case 'notSetUp': return t('ride.problem.notSetUp');
    case 'expired': return t('ride.problem.expired');
    case 'alreadyDecided': return t('ride.problem.alreadyDecided');
    case 'notFound': return t('ride.problem.notFound');
    case 'refused': return t('ride.problem.refused');
    case 'failed': return t('ride.problem.failed');
  }
}

function driverLine(t: TFunction, ride: BookedRide): string | null {
  if (!ride.driver || !ride.vehicle) return null;
  const { make, model, license_plate } = ride.vehicle;
  return t('ride.driver', { name: ride.driver.name, car: `${make} ${model} ${license_plate}` });
}

/** Reached by tapping a ride offer: the drop-off arrives as route params, already checked. */
export default function RideScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ name: string; latitude: string; longitude: string }>();
  const dropoff = useMemo(
    () => ({ name: params.name ?? '', latitude: Number(params.latitude), longitude: Number(params.longitude) }),
    [params.name, params.latitude, params.longitude],
  );
  const { view, busy, getFare, confirm, decline, cancel } = useRide(dropoff);
  const driver = view.phase === 'booked' ? driverLine(t, view.ride) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <InkTitle level={2}>{t('ride.to', { place: dropoff.name })}</InkTitle>

        {view.phase === 'offer' ? <InkText tone="secondary">{t('ride.offerBody')}</InkText> : null}

        {view.phase === 'quoted' ? (
          <>
            <InkText size="xl" weight="bold" numeric>{t('ride.fare', { fare: view.quote.fare.display })}</InkText>
            {view.quote.pickup_eta_mins !== null ? (
              <InkText tone="secondary">{t('ride.pickupIn', { minutes: view.quote.pickup_eta_mins })}</InkText>
            ) : null}
          </>
        ) : null}

        {view.phase === 'booked' ? (
          <>
            <View accessibilityLiveRegion="polite">
              <InkText size="xl" weight="bold">{statusLabel(t, view.ride.status)}</InkText>
            </View>
            {driver ? <InkText tone="secondary">{driver}</InkText> : null}
            {view.ride.pickup_eta_mins !== null ? (
              <InkText tone="secondary">{t('ride.pickupIn', { minutes: view.ride.pickup_eta_mins })}</InkText>
            ) : null}
          </>
        ) : null}

        {view.phase === 'closed' ? (
          <InkText tone="secondary">
            {view.outcome === 'declined'
              ? t('ride.closedDeclined')
              : view.outcome === 'cancelled'
                ? t('ride.closedCancelled')
                : t('ride.closedFailed')}
          </InkText>
        ) : null}

        {view.phase === 'problem' ? <InkNotice tone="danger">{problemLabel(t, view.problem)}</InkNotice> : null}
      </ScrollView>

      <View style={styles.foot}>
        {view.phase === 'offer' ||
        (view.phase === 'problem' &&
          (view.problem === 'expired' || view.problem === 'locationDenied' || view.problem === 'failed')) ? (
          <InkButton variant="primary" block loading={busy} onPress={getFare}>
            {t('ride.getFare')}
          </InkButton>
        ) : null}

        {view.phase === 'quoted' ? (
          <>
            <InkButton variant="primary" block loading={busy} onPress={confirm}>
              {t('ride.confirm')}
            </InkButton>
            <InkButton block disabled={busy} onPress={decline}>
              {t('ride.decline')}
            </InkButton>
          </>
        ) : null}

        {view.phase === 'booked' ? (
          <>
            <InkButton variant="danger" block loading={busy} onPress={cancel}>
              {t('ride.cancel')}
            </InkButton>
            <InkText size="sm" tone="secondary" style={styles.note}>{t('ride.cancelNote')}</InkText>
          </>
        ) : null}

        {view.phase === 'closed' || view.phase === 'problem' ? (
          <InkButton block onPress={() => router.back()}>
            {t('ride.done')}
          </InkButton>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl, paddingBottom: Spacing['2xl'], gap: Spacing.lg },
    foot: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.sm },
    note: { textAlign: 'center' },
  });
