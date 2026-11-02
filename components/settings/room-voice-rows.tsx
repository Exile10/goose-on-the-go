// The room voice rows the Listening and Speaking pages lead with: whether the Pond listens through its
// own microphone, which wake detector it uses and why, and how someone stops it talking. They read
// `GET /voice/room` rather than the settings record, because whether it can listen at all is the
// Pond's answer, not a field.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SwitchRow } from '@/components/settings/setting-controls';
import { RowSeparator, SettingsRow } from '@/components/settings/settings-list';
import { detectorWords, interruptWords, unavailableWords, wakeReasonWords } from '@/models/voice-room';
import { reject } from '@/services/haptics';
import type { PondSettings } from '@/services/types';
import type { UsePondSettings } from '@/view-models/use-pond-settings';
import { useVoiceRoom } from '@/view-models/use-voice-room';

interface Props {
  settings: PondSettings;
  vm: UsePondSettings;
}

/** Listening's lead: the room switch, the detector in use and why, and how a reply is stopped. */
export function RoomVoiceRows({ settings, vm }: Props) {
  const { t } = useTranslation();
  const voice = useVoiceRoom();
  const [error, setError] = useState<string | null>(null);
  const room = voice.room;

  if (voice.missing) return <SettingsRow label={t('voiceAgent.hears.room')} description={t('voiceRoom.missing')} />;
  if (!room) return <SettingsRow label={t('voiceAgent.hears.room')} description={voice.error ?? t('voiceRoom.reading')} />;

  return (
    <>
      <SwitchRow
        label={t('voiceAgent.hears.room')}
        description={room.available ? t('voiceAgent.hears.roomHint') : unavailableWords(room.unavailable_reason)}
        value={room.enabled}
        disabled={!room.available || voice.switching}
        error={error}
        onChange={(on) => {
          setError(null);
          void voice.actions.setEnabled(on).then((refused) => {
            if (refused) {
              void reject();
              setError(refused);
            } else {
              void vm.actions.refresh();
            }
          });
        }}
      />
      <RowSeparator />
      <SettingsRow
        label={t('voiceAgent.hears.detector')}
        value={detectorWords(room.wake.detector)}
        description={wakeReasonWords(room.wake.reason)}
        note={room.wake.detector === 'whisper' ? t('voiceRoom.whisperNote', { phrase: room.wake.phrase || settings.voice_wake_word }) : null}
      />
      <RowSeparator />
      <SettingsRow label={t('voiceAgent.hears.interrupts')} description={interruptWords(room.interrupts, room.wake.phrase || settings.voice_wake_word)} />
    </>
  );
}

/** Speaking's lead: how someone stops a reply in the room. */
export function RoomInterruptRow({ settings }: Props) {
  const { t } = useTranslation();
  const voice = useVoiceRoom();
  const room = voice.room;
  const description = voice.missing
    ? t('voiceRoom.missing')
    : room
      ? interruptWords(room.interrupts, room.wake.phrase || settings.voice_wake_word)
      : (voice.error ?? t('voiceRoom.reading'));
  return <SettingsRow label={t('voiceAgent.hears.interrupts')} description={description} />;
}
