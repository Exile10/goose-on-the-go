/**
 * VoiceDock — voice mode, in the place the composer was.
 *
 * Three things, the layout the user's reference sets: the speaker on the left,
 * which says whether replies are spoken; the orb in the middle, which is the
 * one control that matters and does what the moment needs; the keyboard on
 * the right, back to typing. The conversation stays above it, so what was said
 * and what Goose answered are both on screen while it talks.
 *
 * It owns the voice pipeline (`useVoice`), so the microphone stream exists only
 * while voice mode is open, and closing it stops everything.
 */

import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { inkText, useInkTheme } from '@jarida/ink/native';

import { ChromePuck } from '@/components/patterns/chrome-puck';
import { VoiceOrb } from '@/components/patterns/voice-orb';
import type { TranslationKey } from '@/services/i18n';
import type { VoiceState } from '@/models/voice';
import { selectionTick } from '@/services/haptics';
import type { UseChat } from '@/view-models/use-chat';
import { useVoice } from '@/view-models/use-voice';

const ORB = 132;

/** Shown while there's nothing already said to listen past. */
const SUGGESTIONS_VISIBLE = new Set<VoiceState>(['idle', 'wait', 'recording']);

const PHRASE_KEYS = ['voice.phraseLights', 'voice.phraseWeather', 'voice.phraseTimer', 'voice.phrasePlaylist'] as const;

const CAPTIONS: Record<VoiceState, TranslationKey> = {
  idle: 'chat.voice.idle',
  wait: 'chat.voice.listening',
  recording: 'chat.voice.hearing',
  thinking: 'chat.voice.thinking',
  speaking: 'chat.voice.speaking',
  error: 'chat.voice.idle',
};

const ORB_ACTIONS: Record<VoiceState, TranslationKey> = {
  idle: 'chat.voice.tapToTalk',
  wait: 'chat.voice.tapToStop',
  recording: 'chat.voice.tapToSend',
  thinking: 'chat.voice.tapToCancel',
  speaking: 'chat.voice.tapToInterrupt',
  error: 'chat.voice.tapToTalk',
};

export interface VoiceDockProps {
  send: UseChat['actions']['send'];
  stop: UseChat['actions']['stop'];
  /** Back to the keyboard. */
  onClose: () => void;
  bottomInset: number;
}

export function VoiceDock({ send, stop, onClose, bottomInset }: VoiceDockProps) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const voice = useVoice({ send, stop });
  const { state, level, speaker, error, micBlocked } = voice.data;

  const caption = inkText(theme, {
    size: 'sm',
    weight: theme.weight.semibold,
    color: error ? theme.color.dangerFg : theme.color.textSecondary,
  });
  const hint = inkText(theme, { size: 'xs', weight: theme.weight.regular, color: theme.color.textSecondary });

  return (
    <View style={[styles.dock, { paddingBottom: bottomInset + 8 }]}>
      {/* A microphone the OS will not prompt for again is only recoverable in
          Settings, so the caption that says so is the control that goes there.
          Every other caption is a status line and stays inert. */}
      {micBlocked ? (
        <Pressable
          accessibilityRole="button"
          accessibilityHint={t('chat.voice.micBlockedHint')}
          onPress={() => void Linking.openSettings()}
        >
          <Text
            style={[caption.style, styles.caption, styles.captionAction]}
            accessibilityLiveRegion="polite"
            numberOfLines={2}
          >
            {error}
          </Text>
        </Pressable>
      ) : (
        <Text
          style={[caption.style, styles.caption]}
          accessibilityLiveRegion="polite"
          numberOfLines={2}
        >
          {error ?? t(CAPTIONS[state])}
        </Text>
      )}
      {SUGGESTIONS_VISIBLE.has(state) && (
        <View style={styles.suggestions}>
          <Text style={[hint.style, styles.suggestionsLabel]}>{t('voice.trySaying')}</Text>
          <View style={styles.chipRow}>
            {PHRASE_KEYS.map((key) => (
              <View
                key={key}
                style={[styles.chip, { backgroundColor: theme.color.chrome, borderColor: theme.color.lineStrong }]}
              >
                <Text style={[hint.style, styles.chipText]} numberOfLines={1}>{`"${t(key)}"`}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
      <View style={styles.row}>
        <ChromePuck
          icon={speaker ? 'volume' : 'volume-off'}
          label={t(speaker ? 'chat.voice.speakerOn' : 'chat.voice.speakerOff')}
          onPress={() => {
            void selectionTick();
            voice.actions.toggleSpeaker();
          }}
        />
        <VoiceOrb
          state={state}
          level={level}
          size={ORB}
          onPress={voice.actions.tap}
          accessibilityLabel={t(ORB_ACTIONS[state])}
        />
        <ChromePuck
          icon="keyboard"
          label={t('chat.voice.keyboard')}
          onPress={() => {
            void selectionTick();
            voice.actions.end();
            onClose();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { paddingHorizontal: 16, paddingTop: 4, gap: 6 },
  caption: { textAlign: 'center', minHeight: 18 },
  captionAction: { textDecorationLine: 'underline' },
  suggestions: { alignItems: 'center', gap: 6 },
  suggestionsLabel: { textAlign: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: {},
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
