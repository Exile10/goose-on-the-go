/**
 * HomeManagementScreen — the rooms your devices are in, and the Pond this phone is paired with.
 *
 * Rooms come from the devices, because that is all a room is on the Pond: the `room` field its
 * devices share. Renaming, deleting and adding a room are each a set of device edits
 * (`view-models/rooms.ts`), and a device with no room sits under Unassigned, which can be neither
 * renamed nor deleted.
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
import { unassignRoom } from '@/view-models/rooms';

/** The open sheet: a room's rename, or (`room: null`) a new room. */
type Sheet = { room: string | null } | null;

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
  const state = useContentState({ loading, failed, hasContent: devices.length > 0 });
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
      // Try again sends the same edits: the household already agreed to them.
      const send = async (edits: Parameters<typeof actions.edit>[0]) => {
        const refused = await actions.edit(edits);
        if (refused) {
          void reject();
          snackbar.show({ message: refused, tone: 'danger', action: { label: t('common.retry'), onPress: () => void send(edits) } });
        } else {
          void confirm();
        }
      };
      await send(unassignRoom(devices, room.name));
    },
    [actions, ask, devices, snackbar, t],
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

      {devices.length > 0 ? (
        <SettingsGroup title={t('sections.rooms')} inset={TILE_INSET} footer={t('rooms.footer')}>
          {rooms.map((room) =>
            room.name === UNASSIGNED_ROOM ? (
              <SettingsRow
                key={room.name}
                icon="device"
                tile="slate"
                label={roomLabel(room.name)}
                description={t('rooms.deviceCount', { count: room.devices.length })}
              />
            ) : (
              <SettingsRow
                key={room.name}
                icon="home"
                tile="green"
                label={room.name}
                description={t('rooms.deviceCount', { count: room.devices.length })}
                onPress={() => setSheet({ room: room.name })}
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
          <SettingsRow key="add" icon="plus" tile="purple" label={t('rooms.add')} action onPress={() => setSheet({ room: null })} />
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
          key={sheet.room ?? 'new'}
          devices={devices}
          room={sheet.room}
          onClose={() => setSheet(null)}
          onSave={actions.edit}
        />
      ) : null}
    </SettingsScroll>
  );
}
