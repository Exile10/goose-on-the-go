/**
 * RoomSheet — a new name for a room, or a new room and any devices that go into it.
 *
 * A room is a record of its own on the Pond, so renaming one leaves its devices in it, and a new
 * room may start empty. Two rooms may not share a name, as a person reads names.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkFormField, InkInput, InkNotice, InkSheet, InkText } from '@jarida/ink/native';

import { LabelledCheckbox } from '@/components/patterns/labelled-checkbox';
import { confirm, reject } from '@/services/haptics';
import type { Device } from '@/services/types';
import { Spacing } from '@/constants/spacing';
import { roomLabel, roomOf, type DeviceRoom } from '@/view-models/use-devices';

export interface RoomSheetProps {
  /** Every device the Pond lists. */
  devices: Device[];
  /** Every room, to say which one each device is in now. */
  rooms: DeviceRoom[];
  /** The room being renamed, or null to make a new one. The screen keys the sheet on it. */
  room: DeviceRoom | null;
  onClose: () => void;
  /** Each resolves to why the Pond refused it, or null once it is done. */
  onCreate: (name: string, deviceIds: ReadonlySet<string>) => Promise<string | null>;
  onRename: (room: DeviceRoom, name: string) => Promise<string | null>;
}

export function RoomSheet({ devices, rooms, room, onClose, onCreate, onRename }: RoomSheetProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(room?.name ?? '');
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const inRoom = (d: Device) => {
    const id = roomOf(d, rooms);
    return roomLabel(rooms.find((r) => r.id === id) ?? { id, name: '' });
  };

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
    setError(null);
    setSubmitting(true);
    const refused = room === null ? await onCreate(name, chosen) : await onRename(room, name);
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
                label={t('rooms.deviceInRoom', { device: d.name, room: inRoom(d) })}
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
