/**
 * AssistOverlay — the voice orb over whatever app was open, opened by the phone's assist gesture.
 *
 * A dimmed, see-through backdrop with one panel at its foot. The panel says what the overlay is
 * waiting on until the Pond can be reached, then holds the conversation: the last thing asked and
 * the answer as it arrives, over the same voice dock the conversation screen uses, which starts
 * listening the moment it is drawn. A tap on the backdrop, the back gesture, or the end of the
 * conversation closes it; "Type instead" carries the conversation into the app.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InkButton, InkSpinner, InkText, useInkTheme } from '@jarida/ink/native';

import { VoiceDock } from '@/components/patterns/voice-dock';
import { Spacing } from '@/constants/spacing';
import { useAssist, type Exchange } from '@/view-models/use-assist';

/** Black at 45%: enough to set the panel apart, little enough to keep the app behind it legible. */
const SCRIM = '#00000073';

function ExchangeView({ exchange }: { exchange: Exchange }) {
  if (!exchange.asked && !exchange.answer) return null;
  return (
    <ScrollView style={styles.exchange} contentContainerStyle={styles.exchangeContent}>
      {exchange.asked ? (
        <InkText size="sm" tone="secondary">
          {exchange.asked}
        </InkText>
      ) : null}
      {exchange.answer ? <InkText size="md">{exchange.answer}</InkText> : null}
    </ScrollView>
  );
}

export function AssistOverlay() {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { data, actions } = useAssist();

  return (
    <View style={styles.root}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]}
        onPress={actions.close}
        accessibilityRole="button"
        accessibilityLabel={t('assist.close')}
      />
      <View
        style={[
          styles.panel,
          {
            backgroundColor: theme.color.surface,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            paddingBottom: data.link === 'ready' ? 0 : insets.bottom + Spacing.lg,
          },
        ]}
      >
        {data.link === 'connecting' ? <InkSpinner label={t('assist.connecting')} /> : null}
        {data.link === 'unreachable' ? (
          <View style={styles.unreachable} accessibilityLiveRegion="polite">
            <InkText size="md">{t('assist.unreachable')}</InkText>
            <InkButton variant="primary" block onPress={actions.openApp}>
              {t('assist.openApp')}
            </InkButton>
          </View>
        ) : null}
        {data.link === 'ready' ? (
          <>
            <ExchangeView exchange={data.exchange} />
            <VoiceDock
              send={actions.send}
              stop={actions.stop}
              onClose={actions.openApp}
              bottomInset={insets.bottom}
              onStateChange={actions.voiceChanged}
            />
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  panel: { paddingTop: Spacing.lg, gap: Spacing.md },
  exchange: { maxHeight: 240 },
  exchangeContent: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  unreachable: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
});
