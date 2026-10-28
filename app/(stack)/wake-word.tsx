/**
 * The wake word, left out of owner setup because choosing it well takes a quiet room and five
 * recorded sentences. Reached from Home's "Finish setting up" card; Settings > Listening has the bare field.
 */

import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InkButton, InkNotice, InkSpinner, InkText } from '@jarida/ink/native';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { WakeStep } from '@/components/setup/wake-step';
import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { wakePhrase } from '@/models/owner-setup';
import { useWakeWord } from '@/view-models/use-wake-word';

export default function WakeWordScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const wake = useWakeWord();
  const { draft, saved, valid, changed, justSaved } = wake.data;
  const state = useContentState({ loading: wake.loading, failed: wake.failed, hasContent: !wake.loading && !wake.failed });
  // Reading the settings again keeps the draft: edits are held apart from what the Pond has.
  const pull = usePullToRefresh(wake.actions.reload);

  if (wake.loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]} edges={['bottom']}>
        <InkSpinner label={t('setup.loading')} />
      </SafeAreaView>
    );
  }
  if (isUnavailable(state)) {
    // In a scroll view, centred, so the pull that tries again has something to pull.
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.center} refreshControl={<RefreshControl {...pull} />}>
          <ContentUnavailable state={state} onRetry={wake.actions.reload} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <GKeyboardView>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl {...pull} />}
        >
          {saved && !justSaved ? <InkText tone="secondary">{t('setup.wake.current', { phrase: saved })}</InkText> : null}
          <WakeStep draft={draft} patch={wake.actions.patch} />
          {justSaved ? <InkNotice tone="success">{t('setup.wake.saved', { phrase: wakePhrase(draft) })}</InkNotice> : null}
          {wake.error ? <InkNotice tone="danger">{wake.error}</InkNotice> : null}
        </ScrollView>
        <View style={styles.foot}>
          <InkButton variant="primary" block disabled={!valid || !changed || wake.saving} onPress={() => void wake.actions.save()}>
            {t('setup.wake.save')}
          </InkButton>
        </View>
      </GKeyboardView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    center: { flexGrow: 1, justifyContent: 'center', padding: Spacing.lg },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing['2xl'], gap: Spacing.xl },
    foot: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  });
