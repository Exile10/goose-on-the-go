/**
 * DevicesTab — the devices this Pond has, grouped by the rooms they are in.
 *
 * Every control here is gated on the device's own `capabilities`. That list is
 * what the Matter controller derived from the device's clusters, and it is the
 * fact that stops a contact sensor being offered a power button — an unmapped
 * device arrives with an empty list, which means no controls rather than an
 * error.
 *
 * Reachable devices sort first. A household accumulates rows for things that
 * were unplugged or replaced, and the one being reached for is almost never the
 * dead one.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  InkButton,
  InkCard,
  InkChoice,
  InkEmptyState,
  InkNotice,
  InkSpinner,
  InkSwitch,
  InkText,
  InkTitle,
} from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { useBottomBarInset, useChromeScroll } from '@/providers/chrome-provider';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { selectionTick, toggle } from '@/services/haptics';
import { deviceStyle } from '@/constants/device-style';
import { ALL_ROOMS, UNASSIGNED_ROOM, roomLabel, supports, useDevices } from '@/view-models/use-devices';
import { DeviceEditSheet } from '@/components/patterns/device-edit-sheet';
import type { Device } from '@/services/types';
import { Grey } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';

/** Device card. The switch appears only for devices that accept one; a tap opens its name and room. */
const DeviceCard = React.memo(function DeviceCard({
  device,
  power,
  onToggle,
  onEdit,
}: {
  device: Device;
  power: boolean | undefined;
  onToggle: (device: Device, on: boolean) => void;
  onEdit: (device: Device) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { icon, color } = deviceStyle(device);
  const canPower = supports(device, 'power');
  const on = power ?? false;
  const lit = on && device.is_online;

  const handleToggle = useCallback(
    (next: boolean) => {
      void toggle();
      onToggle(device, next);
    },
    [device, onToggle],
  );

  /**
   * What the device is doing where it says so, and reachability where it does
   * not. Online is not the same fact as on, and it is labelled as one.
   */
  const detail = !device.is_online
    ? t('common.offline')
    : power === undefined
      ? t('common.online')
      : t(power ? 'common.on' : 'common.off');

  return (
    <InkCard style={styles.card} pressable onPress={() => onEdit(device)}>
      <View style={styles.cardTop}>
        <View style={[styles.iconWrap, { backgroundColor: color + '1F' }]}>
          <GIcon name={icon} size={17} color={lit ? color : Grey[500]} />
        </View>
        {canPower ? (
          <InkSwitch checked={on} onChange={handleToggle} disabled={!device.is_online} />
        ) : null}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {device.name}
      </Text>
      <Text style={[styles.detail, !device.is_online && styles.detailMuted]}>{detail}</Text>
    </InkCard>
  );
});

export default function DevicesTab() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { data, loading, error, actions } = useDevices();
  const [activeRoom, setActiveRoom] = useState(ALL_ROOMS);
  const [editing, setEditing] = useState<Device | null>(null);
  const chrome = useChromeScroll();
  const bottomInset = useBottomBarInset();

  const visibleRooms = useMemo(
    () =>
      activeRoom === ALL_ROOMS
        ? data.rooms
        : data.rooms.filter((r) => r.name === activeRoom),
    [activeRoom, data.rooms],
  );

  const handleToggle = useCallback(
    (device: Device, on: boolean) => void actions.setState(device, { power: on }),
    [actions],
  );

  const handleRefresh = useCallback(() => {
    void selectionTick();
    void actions.refresh();
  }, [actions]);

  const handleEdit = useCallback((device: Device) => {
    void selectionTick();
    setEditing(device);
  }, []);

  const namedRooms = useMemo(
    () => data.rooms.map((r) => r.name).filter((name) => name !== UNASSIGNED_ROOM),
    [data.rooms],
  );

  const pickRoom = useCallback((room: string) => {
    void selectionTick();
    setActiveRoom(room);
  }, []);

  const total = data.devices.length;
  const nothingReachable = total > 0 && data.onlineCount === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Title, count and actions each get their own line: squeezed into one
          row at phone width, the count wrapped and both buttons shrank. */}
      <View style={styles.header}>
        <InkTitle level={1}>{t('devices.title')}</InkTitle>
        <Text style={styles.subtitle} numberOfLines={1}>
          {t('devices.count', { count: total })}
          {total > 0 ? ` · ${t('devices.online', { count: data.onlineCount })}` : ''}
        </Text>
        {/* Add lives up here rather than under the grid, so it stays in reach
            however many devices there are. With none, the empty state below
            carries it instead, and the screen still has a single primary. */}
        <View style={styles.headerActions}>
          {total > 0 ? (
            <InkButton
              variant="primary"
              icon="plus"
              block
              style={styles.headerButton}
              onPress={() => router.push('/(stack)/commission-device')}
            >
              {t('devices.addDevice')}
            </InkButton>
          ) : null}
          <InkButton
            variant="quiet"
            icon="refresh"
            block={total > 0}
            style={total > 0 ? styles.headerButton : null}
            onPress={handleRefresh}
          >
            {t('common.refresh')}
          </InkButton>
        </View>
      </View>

      {/* Room tabs, derived from the rooms devices are actually in. The
          view-model returns none when there is only one room to show. A tab
          is a room id, not a name: "All" and "Unassigned" are ids, and
          `roomLabel` is what turns any of them into words. */}
      {data.roomTabs.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabsScroll}
          contentContainerStyle={styles.tabsRow}
        >
          {data.roomTabs.map((tab) => (
            <InkChoice
              key={tab}
              role="radio"
              shape="pill"
              selected={activeRoom === tab}
              onSelect={() => pickRoom(tab)}
            >
              {roomLabel(tab)}
            </InkChoice>
          ))}
        </ScrollView>
      ) : null}

      <ScrollView
        {...chrome}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        {/* The controller can take minutes to come up on first use, and nothing
            can be commissioned until it has. Say so rather than failing later. */}
        {data.matter?.state === 'connecting' ? (
          <InkNotice tone="info">{t('devices.matterStarting')}</InkNotice>
        ) : null}
        {data.matter?.state === 'unreachable' ? (
          <InkNotice tone="warning">{t('devices.matterUnreachable')}</InkNotice>
        ) : null}

        {/* Said once at the top rather than on every card. Twenty-two rows each
            reading "Offline" is the same fact repeated, not twenty-two facts. */}
        {nothingReachable && !loading ? (
          <View style={styles.notice}>
            <InkNotice tone="warning">{t('devices.allOfflineBody')}</InkNotice>
          </View>
        ) : null}

        {loading ? <InkSpinner label={t('pond.checking')} /> : null}

        {error ? (
          <View style={styles.notice}>
            <InkNotice tone="danger">{error}</InkNotice>
          </View>
        ) : null}

        {/* A list that failed to load is unknown, not empty: the notice above
            says so, and "No devices yet" would be a claim nobody made. */}
        {!loading && !error && total === 0 ? (
          <InkEmptyState
            icon="device"
            title={t('devices.noneTitle')}
            action={
              <InkButton
                variant="primary"
                onPress={() => router.push('/(stack)/commission-device')}
              >
                {t('devices.addDevice')}
              </InkButton>
            }
          >
            <InkText>{t('devices.noneBody')}</InkText>
          </InkEmptyState>
        ) : null}

        {visibleRooms.map((room) => (
          <View key={room.name} style={styles.roomSection}>
            {/* One room needs no heading — the screen is already that room. */}
            {data.rooms.length > 1 ? <InkTitle level={3}>{roomLabel(room.name)}</InkTitle> : null}
            <View style={styles.grid}>
              {room.devices.map((d) => (
                <DeviceCard
                  key={d.id}
                  device={d}
                  power={data.powerById[d.id]}
                  onToggle={handleToggle}
                  onEdit={handleEdit}
                />
              ))}
            </View>
          </View>
        ))}

      </ScrollView>

      {editing ? (
        <DeviceEditSheet
          key={editing.id}
          device={editing}
          rooms={namedRooms}
          onClose={() => setEditing(null)}
          onSave={actions.edit}
        />
      ) : null}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    notice: { marginBottom: Spacing.md },

    header: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.md,
    },
    subtitle: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.sm,
      color: c.textTertiary,
      marginTop: Spacing.xs,
    },
    headerActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
    // Split the row evenly, so neither label is squeezed by the other.
    headerButton: { flex: 1 },

    // Pins this ScrollView's own height to its content instead of letting it
    // compete for leftover flex space in the column layout below — without
    // this, filtering to a room with fewer devices frees up vertical space
    // that gets redistributed into the tab pills instead of staying blank,
    // stretching them tall.
    tabsScroll: { flexGrow: 0, flexShrink: 0 },
    tabsRow: {
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.md,
      /* Room for the plate under each pill. */
      gap: Spacing.sm,
      alignItems: 'center',
    },

    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
    roomSection: { marginBottom: Spacing.lg, gap: Spacing.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },

    /* InkCard draws its own face and plate. Adding a background, a border and a
       radius on top of that is what turned each card into a purple slab. */
    card: { width: '47%', gap: 2 },
    cardTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.xs,
    },
    iconWrap: {
      width: 34,
      height: 34,
      borderRadius: Radii.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    name: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: c.text,
    },
    detail: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.xs,
      color: c.textSecondary,
    },
    detailMuted: { color: c.textTertiary },
  });
