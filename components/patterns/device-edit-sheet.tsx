/**
 * DeviceEditSheet — a device's name, and the room it is in.
 *
 * Those are the two things `PUT /devices/{id}` lets a person set. The room is picked from the
 * household's rooms, or typed, and a name no room has yet becomes a new room on save. No room is a
 * choice too, and it puts the device under Unassigned.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkChip, InkFormField, InkInput, InkNotice, InkSheet, InkText } from '@jarida/ink/native';

import { confirm, reject } from '@/services/haptics';
import type { Device, Room } from '@/services/types';
import { Spacing } from '@/constants/spacing';
import type { DeviceEdit } from '@/view-models/use-devices';

export interface DeviceEditSheetProps {
  /** The device being edited. The screen keys the sheet on it, so each opening starts afresh. */
  device: Device;
  /** The household's rooms, offered as quick picks. */
  rooms: Room[];
  /** False on a Pond that cannot keep rooms: the room is shown, not offered. */
  roomsEditable: boolean;
  onClose: () => void;
  /** Resolves to why the Pond refused it, or null once it is saved. */
  onSave: (edits: DeviceEdit[]) => Promise<string | null>;
  /** The room with this name, made if there is none yet. */
  roomNamed: (name: string) => Promise<{ id: string } | { error: string }>;
}

export function DeviceEditSheet({ device, rooms, roomsEditable, onClose, onSave, roomNamed }: DeviceEditSheetProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(device.name);
  // Typed, or set by a chip: a name, which is matched to a room, or made one, on save.
  const [room, setRoom] = useState(rooms.find((r) => r.id === device.room_id)?.name ?? '');
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
    let roomId = device.room_id ?? null;
    if (roomsEditable) {
      const found = room.trim() ? await roomNamed(room) : { id: null };
      if ('error' in found) {
        setSubmitting(false);
        void reject();
        setError(found.error);
        return;
      }
      roomId = found.id;
    }
    const refused = await onSave([{ device, name, roomId }]);
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

      {roomsEditable ? (
        <>
          <InkFormField label={t('deviceEdit.room')}>
            <InkInput value={room} onChange={setRoom} placeholder={t('deviceEdit.roomPlaceholder')} />
          </InkFormField>
          <View style={styles.chips}>
            <InkChip selected={!room.trim()} onPress={() => setRoom('')}>
              {t('devices.roomUnassigned')}
            </InkChip>
            {rooms.map((r) => (
              <InkChip key={r.id} selected={room.trim() === r.name} onPress={() => setRoom(r.name)}>
                {r.name}
              </InkChip>
            ))}
          </View>
          <InkText size="sm" tone="tertiary">{t('deviceEdit.roomHint')}</InkText>
        </>
      ) : (
        <InkText size="sm" tone="tertiary">{t('deviceEdit.roomReadOnly')}</InkText>
      )}

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
