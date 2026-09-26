/**
 * ListeningOverlay — Full-screen dark overlay with pulsing rings, Goose
 * logo, a real VU meter, the recognized transcript, and a cancel button.
 *
 * Driven by `useVoice()`'s real pipeline state — not a fixed "Listening..."
 * label. Triggered by mic FAB or "Ask Goose" bar.
 *
 * @example
 *   <ListeningOverlay
 *     visible={isListening}
 *     state={data.state}
 *     vuLevel={data.vuLevel}
 *     transcript={data.transcript}
 *     onCancel={actions.stop}
 *   />
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Modal, Linking } from 'react-native';
import { InkButton, InkIcon } from '@jarida/ink/native';

import { VuMeter } from '@/components/patterns/vu-meter';
import { useMicrophonePermission } from '@/hooks/use-microphone-permission';
import type { VoiceState } from '@/models/voice';
import { Brand, JaridaPurple, Grey, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import i18n from '@/services/i18n';

/** Example phrases for the listening overlay, from literal keys so the i18n test sees each one. */
function suggestedPhrases(): string[] {
  return [
    i18n.t('voice.phraseLights'),
    i18n.t('voice.phraseWeather'),
    i18n.t('voice.phraseTimer'),
    i18n.t('voice.phrasePlaylist'),
  ];
}

/** State label, from literal keys so the i18n test sees each one. */
function stateLabel(state: VoiceState): string {
  switch (state) {
    case 'idle':
      return i18n.t('voice.idle');
    case 'waiting':
    case 'recording':
      return i18n.t('voice.listening');
    case 'thinking':
      return i18n.t('voice.thinking');
    case 'speaking':
      return i18n.t('voice.speaking');
    case 'error':
      return i18n.t('voice.error');
  }
}

export interface ListeningOverlayProps {
  /** Whether the overlay is visible */
  visible: boolean;
  /** Current pipeline state — drives the label, the VU meter, and the pulse rings. */
  state: VoiceState;
  /** 0..1 display level from the real mic input (already visually scaled — see the store). */
  vuLevel: number;
  /** The user's recognized utterance for this turn, once transcribed. */
  transcript: string | null;
  /** The specific reason for `state === 'error'` — shown under the heading. */
  errorMessage?: string | null;
  /** Called when the user cancels — also how a mid-turn tap barges in. */
  onCancel: () => void;
}

/** Pulsing ring animation */
function PulseRing({ delay, size }: { delay: number; size: number }) {
  const [scaleAnim] = useState(() => new Animated.Value(0.8));
  const [opacityAnim] = useState(() => new Animated.Value(0.4));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1.3,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0,
            duration: 1200,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 0.8,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0.4,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [delay, scaleAnim, opacityAnim]);

  return (
    <Animated.View
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          transform: [{ scale: scaleAnim }],
          opacity: opacityAnim,
        },
      ]}
    />
  );
}

function ListeningOverlayInner({ visible, state, vuLevel, transcript, errorMessage, onCancel }: ListeningOverlayProps) {
  const [permission, requestPermission] = useMicrophonePermission();

  if (!visible) return null;

  const showSuggestions = state === 'idle' || state === 'waiting' || state === 'recording';

  // Permission not yet determined — the hook answers on the next render.
  if (!permission) {
    return (
      <Modal visible={visible} animationType="fade" transparent statusBarTranslucent onRequestClose={onCancel}>
        <View style={styles.overlay} />
      </Modal>
    );
  }

  if (!permission.granted) {
    // Once `canAskAgain` is false the OS won't show the prompt again — Settings is the only way back.
    const canPrompt = permission.canAskAgain;
    return (
      <Modal visible={visible} animationType="fade" transparent statusBarTranslucent onRequestClose={onCancel}>
        <View style={styles.overlay}>
          <View style={styles.permissionContainer}>
            <InkIcon name="voice" size={32} tone="brand" />
            <Text style={styles.permissionTitle}>{i18n.t('voice.micPermissionTitle')}</Text>
            <Text style={styles.permissionDesc}>{i18n.t('voice.micPermissionDesc')}</Text>
            <InkButton
              variant="primary"
              onPress={canPrompt ? requestPermission : () => void Linking.openSettings()}
            >
              {canPrompt ? i18n.t('voice.enableMicrophone') : i18n.t('voice.openSettings')}
            </InkButton>
            <Pressable onPress={onCancel} hitSlop={8}>
              <Text style={styles.cancelText}>{i18n.t('voice.notNow')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="fade" transparent statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        {/* Pulsing rings */}
        <View style={styles.ringsContainer}>
          <PulseRing delay={0} size={200} />
          <PulseRing delay={400} size={260} />
          <PulseRing delay={800} size={320} />

          {/* Center Goose logo */}
          <View style={styles.logoCircle}>
            {/* eslint-disable-next-line i18next/no-literal-string -- the Goose mark, not copy */}
            <Text style={styles.logoText}>G</Text>
          </View>
        </View>

        {/* State label */}
        <Text style={[styles.listeningLabel, state === 'error' && styles.errorLabel]}>
          {stateLabel(state)}
        </Text>

        {/* The specific reason, when there is one to show */}
        {state === 'error' && errorMessage ? <Text style={styles.transcript}>{errorMessage}</Text> : null}

        {/* Recognized transcript, once available */}
        {transcript ? <Text style={styles.transcript}>{`"${transcript}"`}</Text> : null}

        {/* Real mic level while recording */}
        <VuMeter level={vuLevel} active={state === 'recording'} barCount={20} />

        {/* Suggested phrases — decorative, shown before/while recording */}
        {showSuggestions && (
          <View style={styles.suggestedSection}>
            <Text style={styles.suggestedTitle}>{i18n.t('voice.trySaying')}</Text>
            {suggestedPhrases().map((phrase) => (
              <Pressable key={phrase} style={styles.phraseChip}>
                <Text style={styles.phraseText}>{`"${phrase}"`}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Cancel button — also barges in mid-turn */}
        <Pressable style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelText}>{i18n.t('common.cancel')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

export const ListeningOverlay = React.memo(ListeningOverlayInner);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(28,28,28,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },

  /* Permission gate */
  permissionContainer: {
    alignItems: 'center',
    gap: Spacing.lg,
    paddingHorizontal: Spacing['2xl'],
  },
  permissionTitle: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Brand.white,
    textAlign: 'center',
  },
  permissionDesc: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },

  /* Rings */
  ringsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 320,
    height: 320,
    marginBottom: Spacing.xl,
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: JaridaPurple[400],
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: JaridaPurple[500],
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  logoText: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize['2xl'],
    fontWeight: FontWeight.bold,
    color: Brand.white,
  },

  /* Label */
  listeningLabel: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Brand.white,
    marginBottom: Spacing.md,
  },
  errorLabel: {
    color: Semantic.danger,
  },

  /* Transcript */
  transcript: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },

  /* Suggested phrases */
  suggestedSection: {
    alignItems: 'center',
    marginTop: Spacing['3xl'],
    marginBottom: Spacing['3xl'],
  },
  suggestedTitle: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[400],
    marginBottom: Spacing.md,
  },
  phraseChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    marginBottom: Spacing.sm,
  },
  phraseText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: 'rgba(255,255,255,0.7)',
  },

  /* Cancel */
  cancelBtn: {
    marginTop: Spacing['3xl'],
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: Spacing.md,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  cancelText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Brand.white,
  },
});
