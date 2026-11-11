/**
 * Test the wake word: say the phrase ten times, then talk for a minute, and see what the phone's
 * listening would have done (`useWakeTest`). Reached from Settings > Voice and Listening, under
 * "Listen for ...", while the phrase is "hey goose", which is the one the phone hears itself.
 *
 * It also says whose voices can wake this phone, since once anyone is taught here only they can,
 * and offers to teach one when nobody is.
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InkButton, InkCard, InkNotice, InkSpinner, InkText, InkTitle } from '@jarida/ink/native';

import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { PHRASE_TIMES } from '@/models/wake-test';
import { CNN_PHRASE } from '@/services/phone-wake';
import { useWakeTest } from '@/view-models/use-wake-test';

export default function WakeTestScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const vm = useWakeTest();
  const taught = vm.voices?.people.length ?? 0;
  const takes = vm.voices?.people.reduce((n, p) => n + p.takes, 0) ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <InkCard>
          <View style={styles.card}>
            <InkText weight="semibold">{t('wakeTest.voices.title')}</InkText>
            <InkText tone="secondary">
              {taught > 0 ? t('wakeTest.voices.taught', { count: taught, takes }) : t('wakeTest.voices.nobody')}
            </InkText>
            {taught > 0 && vm.voices && !vm.voices.model ? <InkNotice tone="warning">{t('wakeTest.voices.noModel')}</InkNotice> : null}
            <InkButton variant="quiet" onPress={() => router.push({ pathname: '/teach-voice', params: { from: 'wake' } })}>
              {t(taught > 0 ? 'wakeTest.voices.teachAgain' : 'wakeTest.voices.teach')}
            </InkButton>
          </View>
        </InkCard>

        {vm.phase === 'intro' ? (
          <View style={styles.part}>
            <InkTitle level={2}>{t('wakeTest.intro.title')}</InkTitle>
            <InkText>{t('wakeTest.intro.body', { phrase: CNN_PHRASE, count: PHRASE_TIMES })}</InkText>
            <InkText tone="secondary">{t('wakeTest.intro.privacy')}</InkText>
          </View>
        ) : null}

        {vm.phase === 'phrase' ? (
          <View style={styles.part} accessibilityLiveRegion="polite">
            <InkTitle level={2}>{t('wakeTest.phrase.title', { phrase: CNN_PHRASE, count: PHRASE_TIMES })}</InkTitle>
            <InkText tone="secondary">{t('wakeTest.phrase.body')}</InkText>
          </View>
        ) : null}

        {vm.phase === 'talk' ? (
          <View style={styles.part} accessibilityLiveRegion="polite">
            <InkTitle level={2}>{t('wakeTest.talk.title')}</InkTitle>
            <InkText tone="secondary">{t('wakeTest.talk.body', { phrase: CNN_PHRASE })}</InkText>
            <InkText weight="semibold">{t('wakeTest.talk.left', { seconds: Math.ceil(vm.left / 1000) })}</InkText>
          </View>
        ) : null}

        {vm.phase === 'scoring' ? <InkSpinner label={t('wakeTest.scoring')} /> : null}

        {vm.phase === 'done' && vm.result ? (
          <View style={styles.part} accessibilityLiveRegion="polite">
            <InkTitle level={2}>{t('wakeTest.result.title')}</InkTitle>
            <InkText>{t('wakeTest.result.caught', { caught: vm.result.phrase.caught, said: vm.result.phrase.said })}</InkText>
            <InkText>{t('wakeTest.result.falseWakes', { count: vm.result.falseWakes })}</InkText>
            {vm.result.phrase.below > 0 ? (
              <InkText tone="secondary">{t('wakeTest.result.below', { count: vm.result.phrase.below })}</InkText>
            ) : null}
            {vm.result.phrase.voiceRefused > 0 ? (
              <InkText tone="secondary">{t('wakeTest.result.voiceRefused', { count: vm.result.phrase.voiceRefused })}</InkText>
            ) : null}
            {vm.result.phrase.pondRefused > 0 ? (
              <InkText tone="secondary">{t('wakeTest.result.pondRefused', { count: vm.result.phrase.pondRefused })}</InkText>
            ) : null}
            {vm.result.line !== null && !vm.kept ? (
              <InkNotice tone="neutral">
                {t(vm.result.line < vm.result.cnn ? 'wakeTest.result.lower' : 'wakeTest.result.higher')}
              </InkNotice>
            ) : null}
            {vm.kept ? <InkNotice tone="success">{t('wakeTest.result.kept')}</InkNotice> : null}
          </View>
        ) : null}

        {vm.error ? <InkNotice tone="warning">{vm.error}</InkNotice> : null}
      </ScrollView>

      <View style={styles.foot}>
        {vm.phase === 'intro' || vm.phase === 'error' ? (
          <InkButton variant="primary" block disabled={vm.voices === null} onPress={() => void vm.actions.start()}>
            {t('wakeTest.start')}
          </InkButton>
        ) : null}
        {vm.phase === 'phrase' ? (
          <InkButton variant="primary" block onPress={vm.actions.next}>
            {t('wakeTest.phrase.next')}
          </InkButton>
        ) : null}
        {vm.phase === 'done' ? (
          <>
            {vm.result?.line !== null && !vm.kept ? (
              <InkButton variant="primary" block onPress={() => void vm.actions.keepLine()}>
                {t('wakeTest.result.keep')}
              </InkButton>
            ) : null}
            {vm.voices?.chosen ? (
              <InkButton variant="quiet" block onPress={() => void vm.actions.resetLine()}>
                {t('wakeTest.result.reset')}
              </InkButton>
            ) : null}
            <InkButton variant="quiet" block onPress={vm.actions.again}>
              {t('wakeTest.again')}
            </InkButton>
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing['2xl'], gap: Spacing.xl },
    card: { gap: Spacing.sm },
    part: { gap: Spacing.md },
    foot: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.sm },
  });
