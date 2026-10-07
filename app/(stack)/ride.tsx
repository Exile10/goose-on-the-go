import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useInkTheme } from '@jarida/ink/native';

import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
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
  const theme = useInkTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ name: string; latitude: string; longitude: string }>();
  const dropoff = useMemo(
    () => ({ name: params.name ?? '', latitude: Number(params.latitude), longitude: Number(params.longitude) }),
    [params.name, params.latitude, params.longitude],
  );
  const { view, busy, getFare, confirm, decline, cancel } = useRide(dropoff);

  return <View style={styles.page}>
    <Text style={styles.title}>{t('ride.to', { place: dropoff.name })}</Text>

    {view.phase === 'offer' && <>
      <Text style={styles.body}>{t('ride.offerBody')}</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={getFare} style={styles.primary}>
        <Text style={styles.primaryText}>{t('ride.getFare')}</Text>
      </Pressable>
    </>}

    {view.phase === 'quoted' && <>
      <Text style={styles.fare}>{t('ride.fare', { fare: view.quote.fare.display })}</Text>
      {view.quote.pickup_eta_mins !== null &&
        <Text style={styles.body}>{t('ride.pickupIn', { minutes: view.quote.pickup_eta_mins })}</Text>}
      <Pressable accessibilityRole="button" disabled={busy} onPress={confirm} style={styles.primary}>
        <Text style={styles.primaryText}>{t('ride.confirm')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={decline} style={styles.secondary}>
        <Text style={styles.secondaryText}>{t('ride.decline')}</Text>
      </Pressable>
    </>}

    {view.phase === 'booked' && <>
      <Text accessibilityLiveRegion="polite" style={styles.fare}>{statusLabel(t, view.ride.status)}</Text>
      {driverLine(t, view.ride) && <Text style={styles.body}>{driverLine(t, view.ride)}</Text>}
      {view.ride.pickup_eta_mins !== null &&
        <Text style={styles.body}>{t('ride.pickupIn', { minutes: view.ride.pickup_eta_mins })}</Text>}
      <Pressable accessibilityRole="button" disabled={busy} onPress={cancel} style={styles.secondary}>
        <Text style={styles.secondaryText}>{t('ride.cancel')}</Text>
      </Pressable>
      <Text style={styles.note}>{t('ride.cancelNote')}</Text>
    </>}

    {view.phase === 'closed' && <Text style={styles.body}>
      {view.outcome === 'declined' ? t('ride.closedDeclined')
        : view.outcome === 'cancelled' ? t('ride.closedCancelled')
          : t('ride.closedFailed')}
    </Text>}

    {view.phase === 'problem' && <>
      <Text accessibilityRole="alert" style={[styles.body, { color: theme.color.dangerFg }]}>
        {problemLabel(t, view.problem)}
      </Text>
      {(view.problem === 'expired' || view.problem === 'locationDenied' || view.problem === 'failed') &&
        <Pressable accessibilityRole="button" disabled={busy} onPress={getFare} style={styles.primary}>
          <Text style={styles.primaryText}>{t('ride.getFare')}</Text>
        </Pressable>}
    </>}

    {busy && <ActivityIndicator />}
    {(view.phase === 'closed' || view.phase === 'problem') &&
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondary}>
        <Text style={styles.secondaryText}>{t('ride.done')}</Text>
      </Pressable>}
  </View>;
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    page: { flex: 1, padding: 28, gap: 20, backgroundColor: c.background },
    title: { fontSize: 28, fontWeight: '600', color: c.text },
    fare: { fontSize: 22, fontWeight: '600', color: c.text },
    body: { fontSize: 16, lineHeight: 24, color: c.textSecondary },
    note: { fontSize: 14, lineHeight: 20, color: c.textSecondary, textAlign: 'center' },
    primary: { padding: 18, borderRadius: 12, backgroundColor: c.tint, alignItems: 'center' },
    primaryText: { color: c.textOnBrand, fontSize: 16 },
    secondary: { padding: 18, alignItems: 'center' },
    secondaryText: { color: c.textBrand, fontSize: 16 },
  });
