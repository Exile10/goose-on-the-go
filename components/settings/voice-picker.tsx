/**
 * pond-desktop's voice picker, in Ink: the face on its stage saying the line being played, the
 * accents as pills, each accent's voices as chips with Kokoro's grade, the pace, and play. Choosing
 * a voice saves it, has the engine switch to it, and then says the next line in it.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkChoice, InkEyebrow, InkField, InkNotice, InkSpinner, InkStage, useInkTheme } from '@jarida/ink/native';

import { VoiceOrb } from '@/components/patterns/voice-orb';
import { GIcon } from '@/components/ui/g-icon';
import { Spacing } from '@/constants/spacing';
import { describeVoice, sortVoices, voiceInUse, VOICE_LANGUAGES, type VoiceInfo } from '@/models/pond-settings';
import type { VoiceState } from '@/models/voice';
import { selectionTick } from '@/services/haptics';
import type { UsePondSettings } from '@/view-models/use-pond-settings';
import { useModelChoices, voiceChoices } from '@/view-models/use-settings-extras';
import { useVoicePreview, type PreviewState } from '@/view-models/use-voice-preview';
import { sliderText } from './setting-controls';
import { SettingsMessage } from './settings-list';
import { SettingsSlider } from './settings-slider';
import { useSettingsStyles, type SettingsColors, type SettingsMetrics, type SettingsType } from './settings-theme';

const OTHER = 'other';
type Accent = VoiceInfo['language'] | typeof OTHER;

/** A little under the desktop's 150, so the face, its line and play fit one phone screen. */
const FACE = 128;
// Three a row, all one width: the desktop wraps rather than scrolls, and so does this.
const PER_ROW = 3;
const CHIP_GAP = 10;
/** The best-graded voices shown before "Show all"; most accents have few worth hearing. */
const FEW = 6;

function accentKey(accent: Accent) {
  switch (accent) {
    case 'a':
      return 'settings.voice.accentShort.a' as const;
    case 'b':
      return 'settings.voice.accentShort.b' as const;
    case 'e':
      return 'settings.voice.accentShort.e' as const;
    case 'f':
      return 'settings.voice.accentShort.f' as const;
    case 'h':
      return 'settings.voice.accentShort.h' as const;
    case 'i':
      return 'settings.voice.accentShort.i' as const;
    case 'j':
      return 'settings.voice.accentShort.j' as const;
    case 'p':
      return 'settings.voice.accentShort.p' as const;
    case 'z':
      return 'settings.voice.accentShort.z' as const;
    default:
      return 'settings.voice.accentShort.other' as const;
  }
}

function noteKey(id: string) {
  switch (id) {
    case 'af_heart':
      return 'settings.voice.note.af_heart' as const;
    case 'af_bella':
      return 'settings.voice.note.af_bella' as const;
    case 'af_nicole':
      return 'settings.voice.note.af_nicole' as const;
    default:
      return null;
  }
}

/** The face's state for what the preview is doing; a failed preview rests rather than alarms. */
function faceState(state: PreviewState, applying: boolean): VoiceState {
  if (applying || state === 'loading') return 'thinking';
  if (state === 'playing') return 'speaking';
  return 'idle';
}

export function VoicePicker({ vm }: { vm: UsePondSettings }) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const styles = useSettingsStyles(makeStyles);
  const models = useModelChoices();
  const preview = useVoicePreview();
  const settings = vm.settings;
  const current = voiceInUse(settings?.voice_tts_voice ?? '');
  const applying = vm.voice.applying;
  // A voice fetched by choosing it is installed from then on, without waiting for a re-read.
  const [fetched, setFetched] = useState<ReadonlySet<string>>(() => new Set());
  const [movingPace, setMovingPace] = useState<number | null>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const voices = useMemo(() => voiceChoices(models.items), [models.items]);
  const installed = useMemo(() => new Set(voices.filter((v) => v.installed).map((v) => v.id)), [voices]);
  const infos = useMemo(() => voices.map((v) => describeVoice(v.id)), [voices]);
  const accents = useMemo(() => {
    const present = new Set<Accent>(infos.map((v) => v.language ?? OTHER));
    return [...VOICE_LANGUAGES.filter((l) => present.has(l)), ...(present.has(OTHER) ? [OTHER] : [])] as Accent[];
  }, [infos]);

  if (!settings || (models.loading && voices.length === 0)) {
    return vm.failed ? <SettingsMessage tone="danger">{vm.error}</SettingsMessage> : <InkSpinner label={t('settings.loading')} />;
  }
  if (voices.length === 0) return <SettingsMessage>{models.error ?? t('settings.voice.noVoices')}</SettingsMessage>;

  const chosen = describeVoice(current);
  const accent: Accent = chosen.language ?? OTHER;
  const all = sortVoices(infos.filter((v) => (v.language ?? OTHER) === accent));
  // Collapsed, the list still shows the chosen voice, in place of the last of the few.
  const few = all.slice(0, FEW);
  const shown = showAll || all.length <= FEW ? all : few.some((v) => v.id === current) ? few : [...few.slice(0, FEW - 1), chosen];
  const note = noteKey(chosen.id);
  const grade = chosen.grade ?? t('settings.voice.ungraded');
  const about = note ? t('settings.voice.gradeNote', { grade, note: t(note) }) : t('settings.voice.grade', { grade });

  const pace = movingPace ?? settings.voice_tts_speed;
  const paceText = sliderText('pace', pace, t);
  const said = applying ? t('settings.voice.gettingReady') : preview.statement ?? t('settings.voice.pressPlay');
  const problem = preview.error ?? vm.voice.error ?? vm.fieldErrors.voice_tts_voice ?? vm.fieldErrors.voice_tts_speed ?? null;
  const chipWidth = rowWidth ? Math.floor((rowWidth - CHIP_GAP * (PER_ROW - 1)) / PER_ROW) : undefined;

  const choose = async (id: string) => {
    if (id === current || applying) return;
    void selectionTick();
    preview.stop();
    const kept = await vm.actions.update('voice_tts_voice', id);
    if (!kept) return;
    setFetched((prev) => new Set(prev).add(id));
    void preview.play();
  };

  const chooseAccent = (next: Accent) => {
    if (next === accent) return;
    const best = sortVoices(infos.filter((v) => (v.language ?? OTHER) === next))[0];
    if (best) void choose(best.id);
  };

  const commitPace = async (next: number) => {
    setMovingPace(null);
    if (next === settings.voice_tts_speed) return;
    preview.stop();
    const kept = await vm.actions.update('voice_tts_speed', next);
    if (kept) void preview.play();
  };

  const playLabel =
    preview.state === 'loading' ? t('settings.voice.preparing') : preview.state === 'playing' ? t('settings.voice.stop') : t('settings.voice.play');

  return (
    <View style={styles.picker}>
      {/* Who is speaking, what they say, and play, together: choosing and hearing on one screen. */}
      <InkStage>
        <VoiceOrb state={faceState(preview.state, applying)} level={preview.level} size={FACE} />
        <View style={styles.who}>
          <Text style={styles.name}>{chosen.name}</Text>
          <Text style={styles.about}>{about}</Text>
        </View>
        <Text style={styles.said} accessibilityLiveRegion="polite">
          {said}
        </Text>
        <InkButton
          variant="primary"
          style={styles.play}
          icon={
            preview.state === 'loading' ? (
              <InkSpinner label={t('settings.voice.preparing')} size={16} />
            ) : (
              <GIcon name={preview.state === 'playing' ? 'stop' : 'play'} size={16} color={theme.color.textOnAccent} />
            )
          }
          disabled={applying}
          onPress={() => (preview.busy ? preview.stop() : void preview.play())}
        >
          {playLabel}
        </InkButton>
      </InkStage>

      {problem ? <InkNotice tone="warning">{problem}</InkNotice> : null}

      {accents.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('settings.voice.accent')}
          style={styles.pillScroll}
          contentContainerStyle={styles.pills}
        >
          {accents.map((a) => (
            <InkChoice key={a ?? OTHER} shape="pill" role="radio" selected={a === accent} disabled={applying} onSelect={() => chooseAccent(a)}>
              {t(accentKey(a))}
            </InkChoice>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.voices}>
        <View style={styles.voicesHead}>
          <InkEyebrow>{t('settings.voice.voice')}</InkEyebrow>
          {all.length > FEW ? (
            <Pressable
              onPress={() => {
                void selectionTick();
                setShowAll((open) => !open);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityState={{ expanded: showAll }}
            >
              <Text style={styles.more}>{showAll ? t('settings.voice.showFewer') : t('settings.voice.showAll', { count: all.length })}</Text>
            </Pressable>
          ) : null}
        </View>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('settings.voice.voice')}
          style={styles.chips}
          onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
        >
          {shown.map((v) => {
            const selected = v.id === current;
            const needsDownload = !installed.has(v.id) && !fetched.has(v.id);
            return (
              <View key={v.id} style={chipWidth ? { width: chipWidth } : styles.chip}>
                <InkChoice
                  role="radio"
                  selected={selected}
                  disabled={applying}
                  onSelect={() => void choose(v.id)}
                  meta={
                    <View style={styles.meta}>
                      <Text style={[styles.grade, selected && { color: theme.color.ink }]}>{v.grade ?? t('settings.voice.ungraded')}</Text>
                      {needsDownload ? <GIcon name="download" size={11} color={theme.color.accent} /> : null}
                    </View>
                  }
                >
                  {v.name}
                </InkChoice>
              </View>
            );
          })}
        </View>
      </View>

      <InkField label={t('settings.voice.pace')} reading={paceText}>
        <SettingsSlider
          value={pace}
          min={0.5}
          max={2}
          step={0.05}
          label={t('settings.voice.pace')}
          valueText={paceText}
          disabled={applying}
          onChange={setMovingPace}
          onCommit={(next) => void commitPace(next)}
        />
      </InkField>
    </View>
  );
}

const makeStyles = (c: SettingsColors, type: SettingsType, m: SettingsMetrics) => ({
  picker: { padding: m.rowH, gap: Spacing.xl },
  who: { alignItems: 'center' as const, gap: 2 },
  name: { ...type.heading, fontSize: 20, lineHeight: 25 },
  about: type.mono,
  said: { ...type.body, textAlign: 'center' as const, minHeight: (type.body.lineHeight ?? 20) * 2, maxWidth: 320 },
  play: { alignSelf: 'center' as const },
  // The pills run to the card's edges and scroll under them, so the row reads as one that moves.
  pillScroll: { marginHorizontal: -m.rowH, flexGrow: 0 },
  pills: { flexDirection: 'row' as const, gap: Spacing.sm, paddingHorizontal: m.rowH, paddingBottom: 4 },
  voices: { gap: Spacing.md },
  voicesHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: m.gap },
  more: { ...type.value, color: c.accent },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: CHIP_GAP },
  chip: { flexBasis: '30%' as const },
  meta: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  grade: { ...type.mono, color: c.textTertiary },
});
