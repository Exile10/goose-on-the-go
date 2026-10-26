/**
 * RoomSheet — a new name for a room, or a new room and the devices that go into it.
 *
 * The Pond keeps no list of rooms: a room is the `room` field its devices share. So renaming one
 * renames it on each of its devices, and a new room needs at least one device moved into it, or
 * there would be nothing to hold its name. The sheet says so, rather than offering an empty room
 * that would vanish on the next read.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkFormField, InkInput, InkNotice, InkSheet, InkText } from '@jarida/ink/native';

import { LabelledCheckbox } from '@/components/patterns/labelled-checkbox';
import { confirm, reject } from '@/services/haptics';
import type { Device } from '@/services/types';
import { Spacing } from '@/constants/spacing';
import { roomLabel, roomOf, type DeviceEdit } from '@/view-models/use-devices';
import { moveIntoRoom, renameRoom } from '@/view-models/rooms';

export interface RoomSheetProps {
  /** Every device the Pond lists. */
  devices: Device[];
  /** The room being renamed, or null to make a new one. The screen keys the sheet on it. */
  room: string | null;
  onClose: () => void;
  /** Resolves to why the Pond refused some of it, or null once every device is moved. */
  onSave: (edits: DeviceEdit[]) => Promise<string | null>;
}

export function RoomSheet({ devices, room, onClose, onSave }: RoomSheetProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(room ?? '');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fail = (message: string) => {
    void reject();
    setError(message);
  };

  const choose = (id: string, on: boolean) => {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const submit = async () => {
    if (!name.trim()) return fail(t('rooms.errors.nameRequired'));
    if (room === null && chosen.size === 0) return fail(t('rooms.errors.pickDevice'));
    const edits = room === null ? moveIntoRoom(devices, chosen, name) : renameRoom(devices, room, name);
    setError(null);
    setSubmitting(true);
    const refused = await onSave(edits);
    setSubmitting(false);
    if (refused) return fail(refused);
    void confirm();
    onClose();
  };

  return (
    <InkSheet open onClose={onClose} title={room === null ? t('rooms.addTitle') : t('rooms.renameTitle')}>
      <InkFormField label={t('rooms.name')}>
        <InkInput value={name} onChange={setName} placeholder={t('rooms.namePlaceholder')} />
      </InkFormField>

      {room === null ? (
        <>
          <InkText size="sm" tone="tertiary">{t('rooms.addHint')}</InkText>
          <View style={styles.devices}>
            {devices.map((d) => (
              <LabelledCheckbox
                key={d.id}
                checked={chosen.has(d.id)}
                onChange={(on) => choose(d.id, on)}
                label={t('rooms.deviceInRoom', { device: d.name, room: roomLabel(roomOf(d)) })}
              />
            ))}
          </View>
        </>
      ) : (
        <InkText size="sm" tone="tertiary">{t('rooms.renameHint')}</InkText>
      )}

      {error ? <InkNotice tone="danger">{error}</InkNotice> : null}

      <InkButton variant="primary" block loading={submitting} onPress={submit}>
        {room === null ? t('rooms.create') : t('rooms.save')}
      </InkButton>
    </InkSheet>
  );
}

const styles = StyleSheet.create({
  devices: { gap: Spacing.md },
});
