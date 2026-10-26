/**
 * DeviceEditSheet — a device's name, and the room it is in.
 *
 * Those are the two things `PUT /devices/{id}` lets a person set. The room is typed, or picked
 * from the rooms other devices are already in, because the Pond keeps no list of rooms: a room is
 * whatever its devices say. No room is a choice too, and it puts the device under Unassigned.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkChip, InkFormField, InkInput, InkNotice, InkSheet, InkText } from '@jarida/ink/native';

import { confirm, reject } from '@/services/haptics';
import type { Device } from '@/services/types';
import { Spacing } from '@/constants/spacing';
import type { DeviceEdit } from '@/view-models/use-devices';

export interface DeviceEditSheetProps {
  /** The device being edited. The screen keys the sheet on it, so each opening starts afresh. */
  device: Device;
  /** The rooms devices are in now, named ones only, offered as quick picks. */
  rooms: string[];
  onClose: () => void;
  /** Resolves to why the Pond refused it, or null once it is saved. */
  onSave: (edits: DeviceEdit[]) => Promise<string | null>;
}

export function DeviceEditSheet({ device, rooms, onClose, onSave }: DeviceEditSheetProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(device.name);
  const [room, setRoom] = useState(device.room?.trim() ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      void reject();
      setError(t('errors.deviceNameRequired'));
      return;
    }
    setError(null);
    setSubmitting(true);
    const refused = await onSave([{ device, name, room: room.trim() || null }]);
    setSubmitting(false);
    if (refused) {
      void reject();
      setError(refused);
      return;
    }
    void confirm();
    onClose();
  };

  return (
    <InkSheet open onClose={onClose} title={t('deviceEdit.title')}>
      <InkFormField label={t('deviceEdit.name')}>
        <InkInput value={name} onChange={setName} placeholder={t('deviceEdit.namePlaceholder')} />
      </InkFormField>

      <InkFormField label={t('deviceEdit.room')}>
        <InkInput value={room} onChange={setRoom} placeholder={t('deviceEdit.roomPlaceholder')} />
      </InkFormField>
      <View style={styles.chips}>
        <InkChip selected={!room.trim()} onPress={() => setRoom('')}>
          {t('devices.roomUnassigned')}
        </InkChip>
        {rooms.map((r) => (
          <InkChip key={r} selected={room.trim() === r} onPress={() => setRoom(r)}>
            {r}
          </InkChip>
        ))}
      </View>
      <InkText size="sm" tone="tertiary">{t('deviceEdit.roomHint')}</InkText>

      {error ? <InkNotice tone="danger">{error}</InkNotice> : null}

      <InkButton variant="primary" block loading={submitting} onPress={submit}>
        {t('deviceEdit.save')}
      </InkButton>
    </InkSheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
});
