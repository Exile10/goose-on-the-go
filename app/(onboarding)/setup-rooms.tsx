/**
 * SetupRoomsScreen — setup's last step (issue #166): name the rooms, then put each device the Pond
 * has in one, a tap each. Devices it can see but has not added yet are listed too, each with an
 * Add that opens the code screen carrying the room chosen here.
 *
 * It follows owner setup rather than sitting among its steps, because the Pond answers `/rooms` and
 * `/devices` only once setup is done. Nothing here is required: Done and Skip both go on to where
 * setup would have gone, the owner's interview over Home, or Home.
 */

import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkChip, InkInput, InkNotice, InkSpinner, InkText, InkTitle } from '@jarida/ink/native';

import { RoomSheet } from '@/components/patterns/room-sheet';
import { GIcon } from '@/components/ui/g-icon';
import { GKeyboardView, useFocusedInputReveal } from '@/components/ui/g-keyboard-view';
import { GPressable } from '@/components/ui/g-pressable';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { foundName } from '@/models/setup-rooms';
import { useConfirm } from '@/providers/confirm-provider';
import { confirm, selectionTick } from '@/services/haptics';
import type { Device, DiscoveredDevice } from '@/services/types';
import type { DeviceRoom } from '@/view-models/use-devices';
import { useSetupRooms, type UseSetupRooms } from '@/view-models/use-setup-rooms';

/** A device and its room chips: one tap puts it in that room, a tap on its room again takes it out. */
function PlaceRow({ device, setup }: { device: Device; setup: UseSetupRooms }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { data, actions } = setup;
  const saving = data.placing === device.id;
  return (
    <View style={styles.item}>
      <View style={styles.itemHead}>
        <InkText weight="semibold">{device.name}</InkText>
        {saving ? <InkSpinner size={14} label={t('setupRooms.devices.saving')} /> : null}
      </View>
      <View style={styles.chips}>
        {data.rooms.map((room) => {
          const here = device.room_id === room.id;
          return (
            <InkChip
              key={room.id}
              selected={here}
              onPress={() => {
                if (saving) return;
                void selectionTick();
                void actions.place(device, here ? null : room.id);
              }}
            >
              {room.name}
            </InkChip>
          );
        })}
      </View>
    </View>
  );
}

/** A device the Pond found but has not added: choose its room here, then add it with its code. */
function FoundRow({ device, setup }: { device: DiscoveredDevice; setup: UseSetupRooms }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const [roomId, setRoomId] = useState<string | null>(null);
  const name = foundName(device, t);
  return (
    <View style={styles.item}>
      <View style={styles.itemHead}>
        <InkText weight="semibold">{name}</InkText>
        <InkButton
          size="sm"
          icon="plus"
          onPress={() =>
            router.push({ pathname: '/(stack)/commission-device', params: { name, ...(roomId ? { room: roomId } : {}) } })
          }
        >
          {t('setupRooms.found.add')}
        </InkButton>
      </View>
      <View style={styles.chips}>
        {setup.data.rooms.map((room) => (
          <InkChip
            key={room.id}
            selected={roomId === room.id}
            onPress={() => {
              void selectionTick();
              setRoomId(roomId === room.id ? null : room.id);
            }}
          >
            {room.name}
          </InkChip>
        ))}
      </View>
    </View>
  );
}

export default function SetupRoomsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const ask = useConfirm();
  const params = useLocalSearchParams<{ session?: string; interview?: string }>();
  const setup = useSetupRooms();
  const { data, error, actions } = setup;
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<DeviceRoom | null>(null);
  const scroll = useRef<ScrollView>(null);
  const reveal = useFocusedInputReveal(() => scroll.current);

  const add = useCallback(
    async (room: string) => {
      if (!room.trim()) return;
      if (await actions.addRoom(room)) {
        void confirm();
        setName('');
      }
    },
    [actions],
  );

  const remove = useCallback(
    async (room: DeviceRoom) => {
      if (room.devices.length > 0) {
        const yes = await ask({
          title: t('rooms.deleteTitle', { room: room.name }),
          message: t('rooms.deleteBody', { count: room.devices.length }),
          confirmLabel: t('rooms.delete'),
          destructive: true,
        });
        if (!yes) return;
      }
      await actions.removeRoom(room);
    },
    [actions, ask, t],
  );

  // Where setup would have gone: the interview over Home, so leaving it lands on Home, or Home.
  const leave = useCallback(() => {
    router.replace('/(tabs)');
    if (params.session && params.interview) {
      router.push({ pathname: '/conversation', params: { session: params.session, interview: params.interview } });
    }
  }, [params.interview, params.session, router]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <GKeyboardView>
        <ScrollView ref={scroll} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} {...reveal}>
          <View style={styles.lead}>
            <InkTitle level={2}>{t('setupRooms.title')}</InkTitle>
            <InkText tone="secondary">{t('setupRooms.lead')}</InkText>
          </View>

          {!data.roomsEditable ? <InkNotice tone="warning">{t('rooms.readOnly')}</InkNotice> : null}
          {error ? <InkNotice tone="danger">{error}</InkNotice> : null}

          {data.roomsEditable ? (
            <View style={styles.section}>
              <InkTitle level={3}>{t('setupRooms.rooms.title')}</InkTitle>
              {data.rooms.length === 0 ? <InkText tone="tertiary">{t('setupRooms.rooms.none')}</InkText> : null}
              {data.rooms.map((room) => (
                <View key={room.id} style={styles.roomRow}>
                  <GPressable
                    style={styles.roomName}
                    onPress={() => setRenaming(room)}
                    accessibilityRole="button"
                    accessibilityLabel={t('setupRooms.rooms.renameLabel', { room: room.name })}
                  >
                    <InkText>{room.name}</InkText>
                    <InkText size="sm" tone="tertiary">
                      {t('rooms.deviceCount', { count: room.devices.length })}
                    </InkText>
                  </GPressable>
                  <GPressable
                    onPress={() => void remove(room)}
                    accessibilityRole="button"
                    accessibilityLabel={t('rooms.deleteLabel', { room: room.name })}
                    hitSlop={8}
                  >
                    <GIcon name="trash" size={18} />
                  </GPressable>
                </View>
              ))}
              <View style={styles.addRow}>
                <View style={styles.addInput}>
                  <InkInput
                    value={name}
                    onChange={setName}
                    placeholder={t('setupRooms.rooms.placeholder')}
                    inputProps={{ returnKeyType: 'done', onSubmitEditing: () => void add(name) }}
                  />
                </View>
                <InkButton variant="quiet" icon="plus" disabled={!name.trim()} onPress={() => void add(name)}>
                  {t('setupRooms.rooms.add')}
                </InkButton>
              </View>
              {data.suggestions.length > 0 ? (
                <View style={styles.chips}>
                  {data.suggestions.map((s) => (
                    <InkChip key={s} icon="plus" onPress={() => void add(s)}>
                      {s}
                    </InkChip>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {data.roomsEditable && data.rooms.length > 0 ? (
            <View style={styles.section}>
              <InkTitle level={3}>{t('setupRooms.devices.title')}</InkTitle>
              {data.loading && data.devices.length === 0 ? <InkSpinner label={t('setupRooms.devices.loading')} /> : null}
              {!data.loading && data.devices.length === 0 ? (
                <InkText tone="tertiary">{t('setupRooms.devices.none')}</InkText>
              ) : null}
              {data.devices.map((d) => (
                <PlaceRow key={d.id} device={d} setup={setup} />
              ))}
            </View>
          ) : null}

          {data.roomsEditable ? (
            <View style={styles.section}>
              <View style={styles.itemHead}>
                <InkTitle level={3}>{t('setupRooms.found.title')}</InkTitle>
                <InkButton size="sm" variant="quiet" icon="refresh" onPress={() => void actions.refresh()}>
                  {t('setupRooms.found.look')}
                </InkButton>
              </View>
              {data.foundState === 'loading' ? <InkSpinner label={t('setupRooms.found.looking')} /> : null}
              {data.foundState === 'unavailable' ? (
                <InkText tone="tertiary">{t('setupRooms.found.unavailable')}</InkText>
              ) : null}
              {data.foundState === 'ready' && data.found.length === 0 ? (
                <InkText tone="tertiary">{t('setupRooms.found.none')}</InkText>
              ) : null}
              {data.found.map((d) => (
                <FoundRow key={d.device_identifier} device={d} setup={setup} />
              ))}
              {data.found.length > 0 ? (
                <InkText size="sm" tone="tertiary">{t('setupRooms.found.codeHint')}</InkText>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.foot}>
          <InkButton variant="quiet" onPress={leave}>
            {t('setup.skip')}
          </InkButton>
          <InkButton variant="primary" onPress={leave}>
            {t('setupRooms.done')}
          </InkButton>
        </View>
      </GKeyboardView>

      {renaming ? (
        <RoomSheet
          key={renaming.id}
          devices={[]}
          rooms={data.rooms}
          room={renaming}
          onClose={() => setRenaming(null)}
          onCreate={async () => null}
          onRename={actions.renameRoom}
        />
      ) : null}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing['2xl'], gap: Spacing.xl },
    lead: { gap: Spacing.sm },
    section: { gap: Spacing.md },
    roomRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    roomName: { flex: 1, gap: 2 },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    addInput: { flex: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    item: { gap: Spacing.sm },
    itemHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
    foot: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.md,
    },
  });
