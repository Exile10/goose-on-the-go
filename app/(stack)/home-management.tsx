/**
 * HomeManagementScreen — the household's rooms, and the Pond this phone is paired with.
 *
 * A room is a record of its own on the Pond, so one can be made before anything is in it, and
 * renamed without touching its devices. Deleting one moves its devices to Unassigned first, since
 * the Pond keeps a room that still has a device. Unassigned can be neither renamed nor deleted. A
 * Pond from before rooms had ids only names them on its devices: those are shown, not changed.
 */

import React, { useCallback, useState } from 'react';
import { RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkSpinner } from '@jarida/ink/native';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { RoomSheet } from '@/components/patterns/room-sheet';
import { SettingsGroup, SettingsMessage, SettingsRow, TILE_INSET } from '@/components/settings/settings-list';
import { SettingsNotice, SettingsScroll } from '@/components/settings/settings-scroll';
import { useSettingsColors } from '@/components/settings/settings-theme';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { useConfirm } from '@/providers/confirm-provider';
import { useServer } from '@/providers/server-provider';
import { useSnackbar } from '@/providers/snackbar-provider';
import { hostOf } from '@/services/discovery';
import { confirm, reject } from '@/services/haptics';
import { usePondSettings } from '@/view-models/use-pond-settings';
import { UNASSIGNED_ROOM, roomLabel, useDevices, type DeviceRoom } from '@/view-models/use-devices';

/** The open sheet: a room's rename, or (`room: null`) a new room. */
type Sheet = { room: DeviceRoom | null } | null;

export default function HomeManagementScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useSettingsColors();
  const { data, loading, failed, error, actions } = useDevices();
  const { settings } = usePondSettings();
  const { paired, serverUrl, connectionState } = useServer();
  const [sheet, setSheet] = useState<Sheet>(null);
  const snackbar = useSnackbar();
  const { devices, rooms } = data;
  const state = useContentState({ loading, failed, hasContent: rooms.length > 0 });
  const unavailable = isUnavailable(state);
  const pull = usePullToRefresh(actions.refresh);

  // Not `confirm`: that name is the success haptic here.
  const ask = useConfirm();

  const deleteRoom = useCallback(
    async (room: DeviceRoom) => {
      const yes = await ask({
        title: t('rooms.deleteTitle', { room: room.name }),
        message: t('rooms.deleteBody', { count: room.devices.length }),
        confirmLabel: t('rooms.delete'),
        destructive: true,
      });
      if (!yes) return;
      // Try again deletes the same room: the household already agreed to it.
      const send = async () => {
        const refused = await actions.deleteRoom(room);
        if (refused) {
          void reject();
          snackbar.show({ message: refused, tone: 'danger', action: { label: t('common.retry'), onPress: () => void send() } });
        } else {
          void confirm();
        }
      };
      await send();
    },
    [actions, ask, snackbar, t],
  );

  const pondName = settings?.home_name?.trim() || t('profile.yourPond');
  const pondState =
    connectionState === 'local'
      ? t('connection.local')
      : connectionState === 'remote'
        ? t('connection.remote')
        : t('connection.offline');

  return (
    <SettingsScroll refreshControl={<RefreshControl {...pull} />}>
      {!unavailable && error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}

      {state === 'loading' ? <InkSpinner label={t('pond.checking')} /> : null}
      {/* A list that failed to load is unknown, not empty. */}
      {unavailable ? <ContentUnavailable state={state} reason={error} onRetry={actions.refresh} /> : null}
      {state === 'empty' ? <SettingsMessage>{t('rooms.noDevices')}</SettingsMessage> : null}

      {!unavailable && state !== 'loading' ? (
        <SettingsGroup
          title={t('sections.rooms')}
          inset={TILE_INSET}
          footer={data.roomsEditable ? t('rooms.footer') : t('rooms.readOnly')}
        >
          {rooms.map((room) =>
            room.id === UNASSIGNED_ROOM || !data.roomsEditable ? (
              <SettingsRow
                key={room.id}
                icon={room.id === UNASSIGNED_ROOM ? 'device' : 'home'}
                tile={room.id === UNASSIGNED_ROOM ? 'slate' : 'green'}
                label={roomLabel(room)}
                description={t('rooms.deviceCount', { count: room.devices.length })}
              />
            ) : (
              <SettingsRow
                key={room.id}
                icon="home"
                tile="green"
                label={room.name}
                description={t('rooms.deviceCount', { count: room.devices.length })}
                onPress={() => setSheet({ room })}
                trailing={
                  <GPressable
                    onPress={() => deleteRoom(room)}
                    accessibilityRole="button"
                    accessibilityLabel={t('rooms.deleteLabel', { room: room.name })}
                    hitSlop={8}
                  >
                    <GIcon name="trash" size={18} color={colors.danger} />
                  </GPressable>
                }
              />
            ),
          )}
          {data.roomsEditable ? (
            <SettingsRow key="add" icon="plus" tile="purple" label={t('rooms.add')} action onPress={() => setSheet({ room: null })} />
          ) : null}
        </SettingsGroup>
      ) : null}

      {paired ? (
        <SettingsGroup title={t('rooms.pondTitle')} inset={TILE_INSET}>
          <SettingsRow icon="bridge" tile="slate" label={pondName} value={pondState} />
          {serverUrl ? (
            <SettingsRow icon="link" tile="slate" label={t('rooms.pondAddress')} value={hostOf(serverUrl)} />
          ) : null}
          <SettingsRow
            icon="plus"
            tile="purple"
            label={t('rooms.pairDevice')}
            action
            accessory="next"
            onPress={() => router.push('/(stack)/pond-pairing')}
          />
        </SettingsGroup>
      ) : null}

      {sheet ? (
        <RoomSheet
          key={sheet.room?.id ?? 'new'}
          devices={devices}
          rooms={rooms}
          room={sheet.room}
          onClose={() => setSheet(null)}
          onCreate={actions.createRoom}
          onRename={actions.renameRoom}
        />
      ) : null}
    </SettingsScroll>
  );
}
