/**
 * Setup's last step, and the only one that can be skipped without a second thought: Goose asks what
 * the member is into, so My Goose has news and ideas from the first morning. A Pond without the
 * interests interview passes straight through to where setup would have gone.
 */

import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { InkSpinner, useInkTheme } from '@/components/ui/ink';

import { InterviewChat } from '@/components/goose/interview-chat';
import { Spacing } from '@/constants/spacing';
import { useHub } from '@/view-models/use-hub';
import { useInterestsInterview } from '@/view-models/use-interests-interview';

export default function OnboardingInterestsScreen() {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ session?: string; interview?: string }>();
  const { state, hub } = useHub();
  const offered = state === 'served' && !!hub?.interests;
  const vm = useInterestsInterview(offered);

  // Where setup would have gone: the owner's notes interview over Home, or Home.
  const leave = useCallback(() => {
    router.replace('/(tabs)');
    if (params.session && params.interview) {
      router.push({ pathname: '/conversation', params: { session: params.session, interview: params.interview } });
    }
  }, [params.interview, params.session, router]);

  useEffect(() => {
    if (state === 'absent' || state === 'failed' || (state === 'served' && !hub?.interests)) leave();
  }, [hub?.interests, leave, state]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.color.bg }]} edges={['top', 'bottom']}>
      {offered ? (
        <View style={styles.fill}>
          <InterviewChat vm={vm} onSkip={leave} onFinished={leave} />
        </View>
      ) : (
        <InkSpinner label={t('goose.interview.loading')} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingHorizontal: Spacing.xs },
  fill: { flex: 1 },
});
