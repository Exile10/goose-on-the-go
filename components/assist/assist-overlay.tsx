/**
 * AssistOverlay — the voice orb over whatever app was open, opened by the phone's assist gesture.
 *
 * A dimmed, see-through backdrop with one glass panel floating at its foot, made as the tab bar is
 * (`GlassBlur`, a hairline edge, every corner rounded); on Android 12 and later the window also
 * blurs the app behind it (`Theme.GooseAssist`), which is what the glass shows. Where it cannot
 * (many phones, and any in battery saver) the glass is denser, so the words read over whatever
 * app is behind. The panel says what the overlay is
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

import { Markdown } from '@/components/patterns/markdown';
import { VoiceDock } from '@/components/patterns/voice-dock';
import { GLASS_INTENSITY, GLASS_TINT_ALPHA, GLASS_TINT_ALPHA_UNBLURRED, GlassBlur } from '@/components/ui/glass-blur';
import { overlayBlursBehind } from '@/services/phone-assistant';
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
      {/* The answer is Markdown, as in the conversation; set as text it showed its asterisks. */}
      {exchange.answer ? <Markdown source={exchange.answer} /> : null}
    </ScrollView>
  );
}

export function AssistOverlay() {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { data, actions } = useAssist();
  // Read once as the overlay opens: what is behind it cannot change while it is in front.
  const [blurred] = React.useState(overlayBlursBehind);

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
            marginBottom: insets.bottom + Spacing.sm,
            borderRadius: theme.radius.xl,
            borderWidth: theme.edge.hairlineWidth,
            borderColor: theme.color.lineStrong,
            paddingBottom: data.link === 'ready' ? 0 : Spacing.lg,
          },
        ]}
      >
        <GlassBlur
          tintAlpha={blurred ? GLASS_TINT_ALPHA : GLASS_TINT_ALPHA_UNBLURRED}
          intensity={GLASS_INTENSITY}
          tint={theme.scheme === 'dark' ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
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
              bottomInset={Spacing.sm}
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
  // Inset from the screen's edges like the tab bar, so it reads as a floating plane.
  panel: { marginHorizontal: Spacing.md, paddingTop: Spacing.lg, gap: Spacing.md, overflow: 'hidden' },
  exchange: { maxHeight: 240 },
  exchangeContent: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  unreachable: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
});
