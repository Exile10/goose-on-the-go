/**
 * Teach Goose your voice -- one flow for the wake phrase and Voice Match, after Apple's Hey Siri setup
 * in Ink's material. An intro says what Goose learns and that recordings are not kept, with
 * Recognise my voice on by default. Then five sentences, one at a time, on the theme's ground: "Say"
 * over the sentence, which rests muted and rises to full ink on its offset while the phone hears
 * speech. There is no glow, because state is elevation, not hue. A done screen names the person, says
 * which of their sentences the "hey goose" detector heard, and which detector the Pond now uses and why.
 *
 * Opened from Home's setup card, the Wake word screen and Voice Match, over everything, with no
 * header: the close control is its own. Leaving once a sentence is recorded asks first; Set up later
 * leaves without asking, and Home keeps its setup card.
 */

import { GPressable } from '@/components/ui/g-pressable';
import React, { useCallback, useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InkButton, InkCard, InkNotice, InkSpinner, InkText, InkTitle, inkText, useInkTheme } from '@/components/ui/ink';

import { ProgressBar } from '@/components/settings/model-rows';
import { SwitchRow } from '@/components/settings/setting-controls';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-list';
import { GIcon } from '@/components/ui/g-icon';
import { Spacing } from '@/constants/spacing';
import { consistencyWords, wakeReasonWords } from '@/models/voice-room';
import { useConfirm } from '@/providers/confirm-provider';
import { selectionTick, tap } from '@/services/haptics';
import { phoneWakeSupported } from '@/services/phone-wake';
import { useMember } from '@/view-models/use-household';
import { usePondSettings } from '@/view-models/use-pond-settings';
import { useTeachVoice, type TeachMember, type UseTeachVoice } from '@/view-models/use-teach-voice';

type From = 'setup' | 'wake' | 'match';

export default function TeachVoiceScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const ask = useConfirm();
  const theme = useInkTheme();
  const params = useLocalSearchParams<{ profile?: string; name?: string; phrase?: string; from?: From }>();
  const own = useMember();
  const settings = usePondSettings();

  // Voice Match hands the phone to a person who may have none; anywhere else it is this phone's own.
  const handedTo: TeachMember | null = params.profile ? { id: params.profile, name: params.name ?? '' } : null;
  const member = handedTo ?? (own ? { id: own.id, name: own.displayName } : null);
  const handed = handedTo !== null && handedTo.id !== own?.id;
  const phrase = params.phrase?.trim() || settings.settings?.voice_wake_word?.trim() || t('voiceRoom.defaultPhrase');
  const vm = useTeachVoice({ member, phrase });

  const letGo = useRef(false);
  const guard = vm.phase === 'takes' && vm.recorded > 0;
  useEffect(() => {
    if (!guard) return;
    return navigation.addListener('beforeRemove', (e) => {
      if (letGo.current) return;
      e.preventDefault();
      void ask({
        title: t('teachVoice.leave.title'),
        message: t('teachVoice.leave.body'),
        confirmLabel: t('teachVoice.leave.confirm'),
        cancelLabel: t('teachVoice.leave.keep'),
      }).then((yes) => {
        if (!yes) return;
        letGo.current = true;
        vm.actions.stop();
        navigation.dispatch(e.data.action);
      });
    });
  }, [ask, guard, navigation, t, vm.actions]);

  const close = useCallback(() => {
    void selectionTick();
    router.back();
  }, [router]);

  const later = useCallback(() => {
    void tap();
    letGo.current = true;
    vm.actions.stop();
    router.back();
  }, [router, vm.actions]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.color.bg }]} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <GPressable feedback="none"
          onPress={close}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          style={({ pressed }) => [
            styles.close,
            { backgroundColor: theme.color.chrome, borderColor: theme.color.lineStrong },
            pressed && { opacity: 0.7 },
          ]}
        >
          <GIcon name="x" size={20} color={theme.color.text} />
        </GPressable>
      </View>
      {vm.phase === 'intro' ? (
        <Intro vm={vm} member={member} handed={handed} from={params.from} onLater={later} onChangePhrase={() => router.push('/(stack)/wake-word')} />
      ) : null}
      {vm.phase === 'takes' || vm.retaking !== null ? <Takes vm={vm} onLater={later} /> : null}
      {vm.phase === 'done' && vm.retaking === null ? <Done vm={vm} member={member} handed={handed} onDone={() => router.back()} /> : null}
    </SafeAreaView>
  );
}

function Intro({
  vm,
  member,
  handed,
  from,
  onLater,
  onChangePhrase,
}: {
  vm: UseTeachVoice;
  member: TeachMember | null;
  handed: boolean;
  from: From | undefined;
  onLater: () => void;
  onChangePhrase: () => void;
}) {
  const { t } = useTranslation();
  const { on, available, model } = vm.voiceMatch;
  const name = member?.name ?? '';
  const modelWaits = on && model !== null && model.state !== 'ready';

  return (
    <>
      <ScrollView contentContainerStyle={styles.introScroll}>
        <InkTitle level={1}>{t('teachVoice.intro.title')}</InkTitle>
        {handed && name ? <InkText weight="semibold">{t('teachVoice.intro.handTo', { name })}</InkText> : null}
        <InkText>{t('teachVoice.intro.body', { phrase: vm.phrase })}</InkText>
        <InkText tone="secondary">{on ? t('teachVoice.intro.privacyPrint') : t('teachVoice.intro.privacy')}</InkText>

        {from !== 'wake' ? (
          <SettingsGroup>
            <SettingsRow
              label={t('teachVoice.intro.phrase')}
              value={`“${vm.phrase}”`}
              accessory="next"
              onPress={onChangePhrase}
            />
          </SettingsGroup>
        ) : null}

        <SettingsGroup
          footer={
            !available
              ? member
                ? t('teachVoice.intro.matchMissing')
                : t('teachVoice.intro.matchNoMember')
              : t('teachVoice.intro.matchFooter')
          }
        >
          <SwitchRow
            label={handed && name ? t('teachVoice.intro.matchOther', { name }) : t('teachVoice.intro.matchMine')}
            description={t('teachVoice.intro.matchBody')}
            value={on}
            disabled={!available}
            onChange={vm.actions.setVoiceMatch}
          />
          {modelWaits && model ? (
            <SettingsRow
              label={model.state === 'downloading' ? t('voiceMatch.model.downloading') : model.state === 'failed' ? t('voiceMatch.model.failed') : t('voiceMatch.model.missing')}
              description={model.credit || null}
              value={model.state === 'downloading' && model.progress !== null ? `${Math.round(model.progress * 100)}%` : null}
            >
              {model.state === 'downloading' ? <ProgressBar fraction={model.progress} /> : null}
            </SettingsRow>
          ) : null}
          {modelWaits && model && model.state !== 'downloading' ? (
            <SettingsRow label={t('voiceMatch.model.retry')} icon="download" tile="pink" action onPress={() => void vm.actions.retryModel()} />
          ) : null}
        </SettingsGroup>
        {on && model?.state === 'ready' && model.credit ? (
          <InkText size="sm" tone="secondary">
            {model.credit}
          </InkText>
        ) : null}

        {modelWaits ? <InkNotice tone="neutral">{t('teachVoice.intro.waitForModel')}</InkNotice> : null}
        {!vm.supported ? <InkNotice tone="neutral">{t('chat.voice.needsUpdate')}</InkNotice> : null}
        {vm.error ? <InkNotice tone="warning">{vm.error}</InkNotice> : null}
      </ScrollView>
      <View style={styles.foot}>
        <InkButton
          variant="primary"
          block
          icon="mic"
          loading={vm.starting}
          disabled={modelWaits || !vm.supported}
          onPress={() => void vm.actions.start()}
        >
          {t('teachVoice.intro.start')}
        </InkButton>
        <InkButton variant="quiet" block onPress={onLater}>
          {t('teachVoice.later')}
        </InkButton>
      </View>
    </>
  );
}

/** One sentence to say: the next of the run, or on the done screen a missed one said again. */
function Takes({ vm, onLater }: { vm: UseTeachVoice; onLater: () => void }) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const again = vm.retaking;
  const sentence = (again !== null ? vm.results[again]?.prompt : vm.sentences[vm.index]) ?? '';
  const say = inkText(theme, { role: 'display', size: '2xl', weight: theme.weight.bold, color: theme.color.text });
  // At rest the sentence is slate, which still reads at 5.97:1; heard, it is full ink.
  const words = inkText(theme, { role: 'display', size: '2xl', weight: theme.weight.semibold, color: vm.lit ? theme.color.text : theme.color.textSecondary });
  const note = inkText(theme, { size: 'md', weight: theme.weight.medium, color: theme.color.textSecondary });

  return (
    <>
      <View style={styles.centre}>
        <Text style={[say.style, styles.say]} accessibilityRole="header">
          {t('teachVoice.say')}
        </Text>
        <InkCard raised={vm.lit} contentStyle={styles.sentenceCard}>
          <Text style={[words.style, styles.sentence]} accessibilityLiveRegion="polite">{`“${sentence}”`}</Text>
        </InkCard>
        <View style={styles.status} accessibilityLiveRegion="polite">
          {vm.said ? <Text style={[note.style, styles.statusText]}>{vm.said}</Text> : null}
          {!vm.said && vm.sending ? <InkSpinner label={t('teachVoice.checking')} /> : null}
        </View>
      </View>
      <View style={styles.foot}>
        <Text style={[note.style, styles.count]}>
          {again !== null ? t('teachVoice.again.count', { step: again + 1, count: vm.of }) : t('teachVoice.count', { step: vm.index + 1, count: vm.of })}
        </Text>
        {vm.stopped ? (
          <InkButton variant="primary" block icon="mic" onPress={() => void vm.actions.retry()}>
            {t('teachVoice.tryAgain')}
          </InkButton>
        ) : null}
        {again !== null ? (
          <InkButton variant="quiet" block onPress={vm.actions.cancelRetake}>
            {t('teachVoice.again.cancel')}
          </InkButton>
        ) : (
          <InkButton variant="quiet" block onPress={onLater}>
            {t('teachVoice.later')}
          </InkButton>
        )}
      </View>
    </>
  );
}

function Done({ vm, member, handed, onDone }: { vm: UseTeachVoice; member: TeachMember | null; handed: boolean; onDone: () => void }) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const name = member?.name ?? '';
  const d = vm.detector;
  const title = !vm.voiceMatch.on
    ? t('teachVoice.done.phraseTitle', { phrase: vm.phrase })
    : handed && name
      ? t('teachVoice.done.titleOther', { name })
      : t('teachVoice.done.titleMine');
  const steadiness = vm.voiceMatch.on ? consistencyWords(vm.consistency) : null;
  const firedCount = vm.results.filter((r) => r.detector).length;

  return (
    <>
      <ScrollView contentContainerStyle={styles.introScroll}>
        <InkTitle level={1}>{title}</InkTitle>
        <View style={styles.lines} accessibilityLiveRegion="polite">
          {/* What the phone learned leads: the room's detector below is the Pond's, and stricter. */}
          {vm.voiceMatch.on && phoneWakeSupported() ? <InkText weight="semibold">{t('teachVoice.done.phone')}</InkText> : null}
          <InkText>{t('teachVoice.done.runHeard', { heard: firedCount, of: vm.results.length })}</InkText>
          {d ? (
            <InkText>{d.kind === 'hey_goose' ? t('teachVoice.done.listensHeyGoose') : t('teachVoice.done.whisper', { phrase: vm.phrase })}</InkText>
          ) : null}
          {d && wakeReasonWords(d.reason) ? <InkText tone="secondary">{wakeReasonWords(d.reason)}</InkText> : null}
        </View>
        <View style={styles.lines}>
          {vm.results.map((r, i) => (
            <View
              key={`${i}-${r.prompt}`}
              style={styles.result}
              accessible
              accessibilityLabel={`${r.prompt}. ${r.detector ? t('teachVoice.done.heard') : t('teachVoice.done.missed')}`}
            >
              {/* The glyph's shape carries it, not a colour: a check heard, a cross missed. */}
              <GIcon name={r.detector ? 'check' : 'x'} size={16} color={theme.color.textSecondary} />
              <View style={styles.resultText}>
                <InkText size="sm">{`“${r.prompt}”`}</InkText>
                <InkText size="sm" tone="secondary">
                  {r.detector ? t('teachVoice.done.heard') : t('teachVoice.done.missed')}
                </InkText>
                {!r.detector && r.takeId ? (
                  <View style={styles.again}>
                    <InkButton variant="quiet" size="sm" icon="mic" onPress={() => void vm.actions.retake(i)}>
                      {t('teachVoice.again.action')}
                    </InkButton>
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </View>
        {vm.retakeError ? <InkNotice tone="warning">{vm.retakeError}</InkNotice> : null}
        {steadiness ? <InkText tone="secondary">{steadiness}</InkText> : null}
      </ScrollView>
      <View style={styles.foot}>
        <InkButton variant="primary" block icon="check" onPress={onDone}>
          {t('common.done')}
        </InkButton>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  top: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  introScroll: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xl, gap: Spacing.lg },
  centre: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.lg, gap: Spacing.md },
  say: { textAlign: 'center' },
  sentenceCard: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.lg },
  sentence: { textAlign: 'center' },
  status: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  statusText: { textAlign: 'center' },
  foot: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.sm },
  count: { textAlign: 'center', marginBottom: Spacing.sm },
  lines: { gap: Spacing.sm },
  result: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  resultText: { flex: 1, gap: 2 },
  again: { alignItems: 'flex-start', marginTop: Spacing.xs },
});
