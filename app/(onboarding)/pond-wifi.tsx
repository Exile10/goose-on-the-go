/**
 * The step between claiming a new Pond over Bluetooth and setting it up: which Wi-Fi it joins, then
 * reaching it there. A Pond already on a network passes through without a choice to make.
 */

import React, { useCallback } from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InkButton, InkEmptyState, InkNotice, InkSpinner, InkText, InkTitle } from '@jarida/ink/native';

import { WifiList } from '@/components/setup/wifi-list';
import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { usePondWifi } from '@/view-models/use-pond-wifi';

export default function PondWifiScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const wifi = usePondWifi();
  const { phase, networks, cardId, scanFailure, canResume } = wifi.data;

  // Back would abandon a Pond that is already claimed; the only ways on are forward or "Find it again".
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => sub.remove();
    }, []),
  );

  const body = (() => {
    switch (phase.kind) {
      case 'checking':
        return <InkSpinner label={t('bleSetup.wifi.checking')} />;
      case 'handover':
        return (
          <View accessibilityLiveRegion="polite">
            <InkSpinner label={phase.ssid ? t('bleSetup.wifi.handover', { ssid: phase.ssid }) : t('bleSetup.wifi.handoverWired')} />
          </View>
        );
      case 'unreachable':
        return (
          <InkEmptyState
            icon="wifi"
            title={phase.ssid ? t('bleSetup.wifi.unreachableTitle', { ssid: phase.ssid }) : t('bleSetup.wifi.unreachableTitleWired')}
            action={
              <InkButton variant="primary" icon="refresh" loading={phase.checking} onPress={wifi.actions.checkAgain}>
                {t('bleSetup.wifi.checkAgain')}
              </InkButton>
            }
          >
            {phase.ssid ? t('bleSetup.wifi.unreachableBody', { ssid: phase.ssid }) : t('bleSetup.wifi.unreachableBodyWired')}
          </InkEmptyState>
        );
      case 'reconnecting':
        return (
          <View accessibilityLiveRegion="polite">
            <InkSpinner label={t('bleSetup.wifi.reconnecting', { id: cardId })} />
          </View>
        );
      case 'lost': {
        // A resume needs the claim's tokens, which only this run of the app holds, and only until it fails once.
        const resumable = canResume && !phase.note;
        return (
          <InkEmptyState
            icon="bluetooth"
            title={t('bleSetup.wifi.lostTitle')}
            action={
              <View style={styles.lostActions}>
                {resumable ? (
                  <InkButton variant="primary" icon="refresh" onPress={wifi.actions.reconnect}>
                    {t('bleSetup.wifi.reconnect')}
                  </InkButton>
                ) : null}
                <InkButton variant={resumable ? 'quiet' : 'primary'} onPress={wifi.actions.findAgain}>
                  {t('bleSetup.wifi.findAgain')}
                </InkButton>
              </View>
            }
          >
            {phase.note ?? (resumable ? t('bleSetup.wifi.lostBody') : t('bleSetup.wifi.reconnectFailed'))}
          </InkEmptyState>
        );
      }
      case 'choosing':
      case 'joining':
        return (
          <>
            <InkText tone="secondary">{t('bleSetup.wifi.lede')}</InkText>
            {phase.kind === 'choosing' && phase.scanning && networks.length === 0 ? (
              <InkSpinner label={t('bleSetup.wifi.scanning')} />
            ) : (
              <>
                {scanFailure ? <InkNotice tone="warning">{scanFailure}</InkNotice> : null}
                {phase.kind === 'choosing' && !phase.scanning && networks.length === 0 && !scanFailure ? (
                  <InkText tone="secondary">{t('bleSetup.wifi.none')}</InkText>
                ) : null}
                <WifiList wifi={wifi} />
              </>
            )}
            <View style={styles.start}>
              <InkButton
                variant="quiet"
                icon="refresh"
                disabled={phase.kind !== 'choosing' || phase.scanning}
                onPress={wifi.actions.rescan}
              >
                {t('bleSetup.wifi.rescan')}
              </InkButton>
            </View>
          </>
        );
    }
  })();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <GKeyboardView>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Not an eyebrow: its capitals would print the id unlike the card and the advertised name. */}
          {cardId ? <InkText size="sm" tone="secondary">{t('bleSetup.find.rowName', { id: cardId })}</InkText> : null}
          <InkTitle level={1}>{t('bleSetup.wifi.title')}</InkTitle>
          {body}
        </ScrollView>
      </GKeyboardView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.lg },
    start: { alignItems: 'flex-start' },
    lostActions: { gap: Spacing.sm, alignItems: 'center' },
  });
