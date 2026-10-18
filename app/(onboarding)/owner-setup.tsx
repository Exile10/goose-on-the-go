/**
 * Owner setup, for a Pond with no screen: who you are and where, how Goose talks, and a model only
 * when the Pond has none. Opened after a claim or a pairing to a Pond that is not set up, and on
 * launch while it is not. It ends on Home, which says whether Goose can answer yet.
 */

import React, { useCallback } from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, Stack, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InkButton, InkEmptyState, InkEyebrow, InkMeter, InkNotice, InkSpinner } from '@jarida/ink/native';

import { ModelStep } from '@/components/setup/model-step';
import { SetupFooter, SetupWarmup } from '@/components/setup/setup-chrome';
import { AboutStep } from '@/components/setup/setup-steps';
import { PersonalityStep } from '@/components/setup/personality-step';
import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { SETUP_STEPS } from '@/models/owner-setup';
import { useOwnerSetup, type UseOwnerSetup } from '@/view-models/use-owner-setup';

function StepBody({ setup }: { setup: UseOwnerSetup }) {
  switch (setup.step) {
    case 'about-you':
      return <AboutStep setup={setup} />;
    case 'personality':
      return <PersonalityStep setup={setup} />;
    case 'model':
      return <ModelStep setup={setup} />;
  }
}

export default function OwnerSetupScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const setup = useOwnerSetup();
  // The model step counts only once the Pond has asked for it.
  const count = setup.noChatModel ? SETUP_STEPS.length : SETUP_STEPS.indexOf('model');
  const { index, phase } = setup;
  const back = setup.actions.back;

  // Back is the wizard's own step back; leaving mid-setup would land on a screen that cannot work yet.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (phase === 'wizard' && index > 0) back();
        return phase === 'wizard';
      });
      return () => sub.remove();
    }, [phase, index, back]),
  );

  if (setup.phase === 'alreadyDone' || setup.phase === 'finished') return <Redirect href="/(tabs)" />;
  if (setup.phase === 'unpaired') return <Redirect href="/(onboarding)/welcome" />;

  if (setup.phase === 'loading' || setup.phase === 'failed') {
    return (
      <SafeAreaView style={[styles.safe, styles.center]} edges={['top', 'bottom']}>
        {setup.phase === 'loading' ? (
          <InkSpinner label={t('setup.loading')} />
        ) : (
          <InkEmptyState
            icon="wifi"
            title={t('setup.loadFailed')}
            action={
              <InkButton variant="primary" icon="refresh" onPress={setup.actions.reload}>
                {t('common.retry')}
              </InkButton>
            }
          >
            {t('setup.loadFailedBody')}
          </InkEmptyState>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <GKeyboardView>
        <View style={styles.progress}>
          <InkEyebrow>{t('setup.progress', { step: index + 1, count })}</InkEyebrow>
          <InkMeter value={(index + 1) / count} label={t('setup.progressLabel')} />
        </View>
        {/* Keyed by step, so each step opens at its top rather than where the last one was left. */}
        <ScrollView key={setup.step} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {setup.notice ? <InkNotice tone="warning">{setup.notice}</InkNotice> : null}
          <StepBody setup={setup} />
        </ScrollView>
        <View style={styles.foot}>
          {setup.error ? <InkNotice tone="danger">{setup.error}</InkNotice> : null}
          <SetupWarmup />
          <SetupFooter setup={setup} />
        </View>
      </GKeyboardView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    center: { justifyContent: 'center', padding: Spacing.lg },
    progress: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, gap: Spacing.sm },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing['2xl'], gap: Spacing.xl },
    foot: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.md, gap: Spacing.sm },
  });
